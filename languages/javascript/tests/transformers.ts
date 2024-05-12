/* eslint-disable max-statements */
import { structures } from 'rete-structures'

import { C, Closures, Marker, N } from './utils'

export function treeToFlow(data: { nodes: N[], connections: C[], closures: Closures }) {
  console.time('treeToFlow')
  const graph = structures({
    nodes: [...data.nodes],
    connections: [...data.connections]
  })
  const roots = graph.roots().nodes()

  const markers: Record<N['id'], Marker[]> = {}

  function traverse(node: N, context: Marker[] = []) {
    const outgoerConnections = graph.connections().filter(c => c.source === node.id)

    for (let index = 0; index < outgoerConnections.length; index++) {
      const out = outgoerConnections[index]
      const m: Marker[] = out.source.match(/^(Block|Program)/) ? [...context, { index, context: out }] : context
      const node = graph.nodes().find(n => n.id === out.target)!

      markers[node.id] = m
      traverse(node, m)
    }
  }
  for (const root of roots) {
    traverse(root)
  }

  let mutableGraph = structures({
    nodes: graph.nodes(),
    connections: graph.connections()
  })
  const leaves = mutableGraph.leaves().nodes()

  for (const leaf of leaves) {
    for (const marker of [...markers[leaf.id]].reverse()) {
      const isStillLeaf = mutableGraph.leaves().nodes().includes(leaf)

      if (!isStillLeaf) continue

      const entries = Object.entries(markers)
      const next = mutableGraph.nodes().find(n => n.id === marker.context.source)!.id
      const reconnect = entries.find(([, list]) => list.find(m => m.context.source === next && m.index === marker.index + 1))
      const nextContext = reconnect?.[1]?.[reconnect?.[1].length - 1].context

      if (nextContext) {
        mutableGraph = structures({
          nodes: mutableGraph.nodes(),
          connections: [
            ...mutableGraph.connections().filter(c => c.id !== nextContext.id),
            { source: leaf.id, sourceOutput: 'bind', target: nextContext.target, id: [leaf.id, nextContext.target].join('->') }
          ]
        })
      }
    }
  }

  // normalize body indices
  for (const c of mutableGraph.connections()) {
    c.sourceOutput = c.sourceOutput.replace('body 0', 'bind')
  }

  console.timeEnd('treeToFlow')
  return {
    nodes: mutableGraph.nodes(),
    connections: mutableGraph.connections()
  }
}

export function flowToTree(data: { nodes: N[], connections: C[], closures: Closures }) {
  console.time('flowToTree')
  const nodes = [...data.nodes]
  const connections = [...data.connections]
  const graph = structures({
    nodes,
    connections
  })

  function getNodesParents(scopesNodes: Closures) {
    const nestedNodes: Record<string, string[]> = {}

    // Helper function to recursively process nested scopes
    function processScope(scopeId: string, nodeIds?: Set<string>) {
      (nodeIds || []).forEach(id => {
        if (!scopesNodes[id]) {
          nestedNodes[id] = [scopeId, ...(nestedNodes[id] || [])]
        } else {
          processScope(scopeId, scopesNodes[id])
        }
      })
    }

    for (const scopeId in scopesNodes) {
      processScope(scopeId, scopesNodes[scopeId])
    }

    return nestedNodes
  }

  const nodeParents = getNodesParents(data.closures)

  const visited = new Map<N['id'], N[]>()

  function markBranchingScopes(node: N, scopes: { start: N, exit: N }[] = []) {
    if (visited.has(node.id)) return

    const isBranchNode = node.id.match(/^(If)/)
    const outgoers = graph.outgoers(node.id)

    for (const scope of [...scopes]) {
      if (scope.exit.id === node.id) scopes = scopes.filter(s => s !== scope)
    }

    const exit = isBranchNode && outgoers.nodes().length > 1 ? outgoers.nodes()
      .map(n => graph.successors(n.id))
      .reduce((a, b) => a.intersection({ nodes: b.nodes(), connections: b.connections() }))
      .roots().nodes()[0] : null

    visited.set(node.id, scopes.map(s => s.start))

    for (const outgoer of outgoers.nodes()) {
      markBranchingScopes(outgoer, exit ? [...scopes, { start: node, exit }] : scopes)
    }
  }

  const roots = graph.roots().nodes()

  for (const root of roots) {
    markBranchingScopes(root)
  }

  const indices = new Map<N['id'], number>()

  function traverse(node: N, startNode: N, markers = new Set<string>(), traversed = new Set<N['id']>()) {
    if (traversed.has(node.id)) return markers
    traversed.add(node.id)
    const isStart = node.id === startNode.id

    const incomers = graph.connections().filter(c => c.target === node.id)

    for (let index = 0; index < incomers.length; index++) {
      const inc = incomers[index]

      // TODO subtract scopes
      const sameScope = (visited.get(inc.source) || []).length <= (visited.get(node.id) || []).length
        && (nodeParents[inc.source] || []).length <= (nodeParents[startNode.id] || []).length

      if (isStart && inc.source.match(/^(If)/)) {
        continue
      } else if (inc.source.match(/^(Block|Program)/) && sameScope) {
        markers.add(inc.source)
      } else {
        const n = graph.nodes().find(n => n.id === inc.source)!

        traverse(n, startNode, markers, traversed)
      }
    }
    return markers
  }


  let mutableGraph = structures({
    nodes: graph.nodes(),
    connections: graph.connections()
  })
  let leaves: N[] = []
  const processed = new Set<N['id']>()

  while ((leaves = mutableGraph.difference({
    nodes: mutableGraph.nodes().filter(n => processed.has(n.id)),
    connections: mutableGraph.connections()
  }).leaves().nodes(), leaves.length > 0)) {
    const leaf = leaves[0]
    const markers = traverse(leaf, leaf)

    processed.add(leaf.id)

    for (const marker of markers) {
      const predecessorsIds = mutableGraph.predecessors(marker).nodes().map(n => n.id)
      const isMain = predecessorsIds.every(id => !markers.has(id))

      if (isMain) {
        const index = (indices.get(marker) || 0) - 1

        indices.set(marker, index)

        mutableGraph = structures({
          nodes: mutableGraph.nodes(),
          connections: [
            ...mutableGraph.connections().filter(c => c.target !== leaf.id),
            { source: marker, sourceOutput: `body ${index}`, target: leaf.id, id: [marker, leaf.id].join('->') }
          ]
        })
        break
      }
    }
  }

  // normalize body indices
  for (const c of mutableGraph.connections()) {
    const minIndex = indices.get(c.source) || 0
    const bodyRegexp = /^body (-+\d+)$/

    c.sourceOutput = c.sourceOutput.replace(bodyRegexp, (_, index) => `body ${parseInt(index) - minIndex}`)
  }

  console.timeEnd('flowToTree')
  return {
    nodes: mutableGraph.nodes(),
    connections: mutableGraph.connections()
  }
}
