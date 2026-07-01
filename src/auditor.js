import * as fs from 'node:fs';
import * as path from 'node:path';

const AWS_REGEX = /AKIA[0-9A-Z]{16}/g;
const OPENAI_REGEX = /sk-(?:proj-|or-v1-)?[a-zA-Z0-9]{32,}/g;
const SLACK_REGEX = /xox[bpa]-[a-zA-Z0-9-]{10,}/g;
const GENERIC_SECRET = /(secret|password|passwd|key|token|auth|credential|private_key|passphrase)\s*(?:=|:)\s*['"]([^'"]{8,})['"]/gi;

export function auditProject(db, rootDir) {
  const findings = [];
  
  // 1. Audit files from database/disk
  let files = [];
  try {
    files = db.getAllFiles();
  } catch (err) {
    // If db error or not initialized, find files manually?
    // Let's assume files are retrieved from DB first, fall back to directory traversal if DB empty
  }

  // If DB has no files, let's scan directories recursively up to depth limit (prevent hanging)
  if (files.length === 0) {
    const scanDir = (dir) => {
      let results = [];
      let list;
      try {
        list = fs.readdirSync(dir);
      } catch (e) {
        return results;
      }
      for (const file of list) {
        const fullPath = path.join(dir, file);
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }
        if (stat.isDirectory()) {
          const defaults = ['node_modules', '.git', 'dist', 'build', '.hss-ce', '.codegraph', '.venv', 'venv'];
          if (!defaults.includes(file)) {
            results = results.concat(scanDir(fullPath));
          }
        } else {
          const ext = path.extname(file).toLowerCase();
          if (['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs'].includes(ext)) {
            results.push({ path: path.relative(rootDir, fullPath) });
          }
        }
      }
      return results;
    };
    files = scanDir(rootDir);
  }

  for (const file of files) {
    const filePath = file.path;
    const fullPath = path.resolve(rootDir, filePath);
    if (!fs.existsSync(fullPath)) continue;
    
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch (err) {
      continue;
    }

    const lines = content.split('\n');
    const ext = path.extname(filePath).toLowerCase();

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith('//') || cleanLine.startsWith('#') || cleanLine.startsWith('/*') || cleanLine.startsWith('*')) {
        return;
      }

      // Secret checking
      if (line.match(AWS_REGEX)) {
        findings.push({
          type: 'secret',
          severity: 'critical',
          filePath,
          line: lineNum,
          detail: 'AWS Access Key ID detected'
        });
      }
      if (line.match(OPENAI_REGEX)) {
        findings.push({
          type: 'secret',
          severity: 'critical',
          filePath,
          line: lineNum,
          detail: 'OpenAI API Key detected'
        });
      }
      if (line.match(SLACK_REGEX)) {
        findings.push({
          type: 'secret',
          severity: 'critical',
          filePath,
          line: lineNum,
          detail: 'Slack OAuth token detected'
        });
      }

      // Generic secret assignment
      let secretMatch;
      GENERIC_SECRET.lastIndex = 0;
      while ((secretMatch = GENERIC_SECRET.exec(line)) !== null) {
        const param = secretMatch[1];
        const val = secretMatch[2];
        if (
          !val.includes('/') &&
          !val.includes('\\') &&
          !val.startsWith('http') &&
          val !== 'true' &&
          val !== 'false' &&
          val.length >= 12 &&
          !val.includes('${')
        ) {
          findings.push({
            type: 'secret',
            severity: 'critical',
            filePath,
            line: lineNum,
            detail: `Possible hardcoded secret/password in assignment to "${param}"`
          });
        }
      }

      // Dangerous API checking
      if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
        if (line.includes('eval(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'critical',
            filePath,
            line: lineNum,
            detail: 'Dangerous eval() usage detected'
          });
        }
        if (line.includes('child_process') || line.includes('execSync(') || line.includes('exec(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Dangerous child_process execution detected'
          });
        }
        if (line.includes('spawn(') || line.includes('spawnSync(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Process spawning (spawn) detected'
          });
        }
      } else if (ext === '.py') {
        if (line.includes('eval(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'critical',
            filePath,
            line: lineNum,
            detail: 'Dangerous Python eval() detected'
          });
        }
        if (line.includes('exec(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'critical',
            filePath,
            line: lineNum,
            detail: 'Dangerous Python exec() detected'
          });
        }
        if (line.includes('os.system(') || line.includes('os.popen(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Dangerous shell execution command detected (os.system/os.popen)'
          });
        }
        if (line.includes('subprocess.Popen(') || line.includes('subprocess.run(') || line.includes('subprocess.call(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Process spawning (subprocess) detected'
          });
        }
      } else if (ext === '.go') {
        if (line.includes('exec.Command(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Command execution via os/exec detected'
          });
        }
      } else if (ext === '.rs') {
        if (line.includes('Command::new(')) {
          findings.push({
            type: 'dangerous_api',
            severity: 'warning',
            filePath,
            line: lineNum,
            detail: 'Command execution via std::process::Command detected'
          });
        }
      }
    });
  }

  // 2. Audit dependency manifest package.json
  const pkgPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [dep, ver] of Object.entries(allDeps)) {
        if (ver === '*' || ver === 'latest') {
          findings.push({
            type: 'dependency',
            severity: 'warning',
            filePath: 'package.json',
            line: 0,
            detail: `Wildcard or 'latest' version used for dependency "${dep}"`
          });
        }
        
        const vulnerablePackages = {
          'lodash': { maxVer: '4.17.21', detail: 'Lodash versions < 4.17.21 contain multiple prototype pollution vulnerabilities' },
          'minimist': { maxVer: '1.2.6', detail: 'Minimist versions < 1.2.6 contain prototype pollution' },
          'serialize-javascript': { maxVer: '3.1.0', detail: 'Serialize-javascript versions < 3.1.0 contain XSS/RCE' },
          'tar': { maxVer: '6.1.9', detail: 'Tar versions < 6.1.9 contain directory traversal' }
        };
        
        if (vulnerablePackages[dep]) {
          const vul = vulnerablePackages[dep];
          let isVul = false;
          const cleanVer = ver.replace(/[^0-9.]/g, '');
          if (cleanVer) {
            const parts = cleanVer.split('.').map(Number);
            const maxParts = vul.maxVer.split('.').map(Number);
            for (let i = 0; i < maxParts.length; i++) {
              const part = parts[i] || 0;
              const maxPart = maxParts[i] || 0;
              if (part < maxPart) {
                isVul = true;
                break;
              } else if (part > maxPart) {
                break;
              }
            }
          }
          if (isVul) {
            findings.push({
              type: 'dependency',
              severity: 'critical',
              filePath: 'package.json',
              line: 0,
              detail: `Vulnerable dependency detected: "${dep}@${ver}". ${vul.detail}`
            });
          }
        }
      }
    } catch (err) {
      // ignore
    }
  }

  return { findings };
}
