export function calculatePageRank(files, dependencies, iterations = 20, d = 0.85, personalization = null, gitWeights = null) {
  const N = files.length;
  if (N === 0) return {};

  const filePaths = files.map(f => f.path);
  
  // Calculate incoming dependency count (reference count) for each file
  const refCount = {};
  filePaths.forEach(path => {
    refCount[path] = 0;
  });
  
  dependencies.forEach(dep => {
    if (refCount[dep.to_file] !== undefined) {
      refCount[dep.to_file]++;
    }
  });

  // Set of direct dependencies and callers of personalized files
  const activeDeps = new Set();
  const activeCallers = new Set();
  
  if (personalization && personalization.length > 0) {
    const personalizedSet = new Set(personalization);
    dependencies.forEach(dep => {
      if (personalizedSet.has(dep.from_file)) {
        activeDeps.add(dep.to_file);
      }
      if (personalizedSet.has(dep.to_file)) {
        activeCallers.add(dep.from_file);
      }
    });
  }

  // Calculate score for each file: base count + git weight + personalization
  const scores = {};
  filePaths.forEach(path => {
    // Base score is incoming reference count + 1 (to avoid 0 for unimported files)
    let score = refCount[path] + 1;
    
    // Add Git weight boost
    if (gitWeights && gitWeights[path]) {
      score += Math.log(1 + gitWeights[path]);
    }
    
    // Add Personalization boost (propagate to direct dependencies & callers)
    if (personalization && personalization.includes(path)) {
      score *= 10.0;
    } else if (activeDeps.has(path)) {
      score *= 3.0;
    } else if (activeCallers.has(path)) {
      score *= 2.0;
    }
    
    scores[path] = score;
  });

  // Normalize scores (scale highest to 1.0)
  let maxScore = 0;
  filePaths.forEach(path => {
    if (scores[path] > maxScore) maxScore = scores[path];
  });

  const normalized = {};
  if (maxScore > 0) {
    filePaths.forEach(path => {
      normalized[path] = scores[path] / maxScore;
    });
  } else {
    filePaths.forEach(path => {
      normalized[path] = 0.0;
    });
  }

  return normalized;
}
