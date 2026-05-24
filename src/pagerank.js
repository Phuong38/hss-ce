export function calculatePageRank(files, dependencies, iterations = 20, d = 0.85, personalization = null, gitWeights = null) {
  const N = files.length;
  if (N === 0) return {};

  const filePaths = files.map(f => f.path);
  
  // Calculate weights for teleportation vector V
  const V = {};
  let totalWeight = 0;

  filePaths.forEach(path => {
    let weight = 1.0;
    
    // 1. Git weight boost
    if (gitWeights && gitWeights[path]) {
      // Scale weight logarithmically to prevent single high-commit files from dominating
      weight += Math.log(1 + gitWeights[path]);
    }

    // 2. Personalization boost
    if (personalization && personalization.includes(path)) {
      weight *= 10.0; // Boost active files significantly
    }

    V[path] = weight;
    totalWeight += weight;
  });

  // Normalize teleportation vector V
  filePaths.forEach(path => {
    V[path] = V[path] / totalWeight;
  });

  // Initialize ranks with the teleportation probability distribution
  const ranks = {};
  filePaths.forEach(path => {
    ranks[path] = V[path];
  });

  // Build adjacency list (from_file -> list of to_files)
  const adj = {};
  const inDegree = {};
  filePaths.forEach(path => {
    adj[path] = new Set();
    inDegree[path] = new Set();
  });

  dependencies.forEach(dep => {
    if (adj[dep.from_file] && adj[dep.to_file]) {
      adj[dep.from_file].add(dep.to_file);
      inDegree[dep.to_file].add(dep.from_file);
    }
  });

  // Out degrees
  const outDegreeCount = {};
  filePaths.forEach(path => {
    outDegreeCount[path] = adj[path].size;
  });

  // Power iterations
  for (let iter = 0; iter < iterations; iter++) {
    const nextRanks = {};
    let danglingSum = 0;

    // Calculate sum of ranks from nodes with no out-links (dangling nodes)
    filePaths.forEach(path => {
      if (outDegreeCount[path] === 0) {
        danglingSum += ranks[path];
      }
    });

    filePaths.forEach(path => {
      let rankSum = 0;
      // Sum ranks of all nodes importing this node
      inDegree[path].forEach(incoming => {
        rankSum += ranks[incoming] / outDegreeCount[incoming];
      });

      // PageRank formula with personalized/weighted teleportation vector V
      nextRanks[path] = ((1 - d) * V[path]) + d * (rankSum + danglingSum * V[path]);
    });

    // Update ranks
    Object.assign(ranks, nextRanks);
  }

  // Normalize ranks (scale highest to 1.0)
  let maxRank = 0;
  filePaths.forEach(path => {
    if (ranks[path] > maxRank) maxRank = ranks[path];
  });

  if (maxRank > 0) {
    filePaths.forEach(path => {
      ranks[path] = ranks[path] / maxRank;
    });
  }

  return ranks;
}
