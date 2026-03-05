import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useState, useCallback, useImperativeHandle, forwardRef } from "react";

const NODE_COLORS: Record<string, string> = {
  "csv-import": "#4f46e5",
  filter: "#0891b2",
  transform: "#7c3aed",
  output: "#059669",
};

const initialNodes: Node[] = [
  {
    id: "start",
    type: "default",
    position: { x: 100, y: 80 },
    data: { label: "Start: Upload CSV" },
    style: {
      background: "#1e293b",
      color: "#e0e0e0",
      border: "1px solid #4f46e5",
      borderRadius: 8,
    },
  },
];

const initialEdges: Edge[] = [];

export interface FlowPaneHandle {
  addNode: (nodeType: string, label?: string) => void;
}

export default forwardRef<FlowPaneHandle>(function FlowPane(_props, ref) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);
  const [nodeCounter, setNodeCounter] = useState(1);

  const addNode = useCallback(
    (nodeType: string, label?: string) => {
      const id = `node-${nodeCounter}`;
      const color = NODE_COLORS[nodeType] || "#4f46e5";
      const displayLabel = label || nodeType;

      // Position new node below the last one
      const lastNode = nodes[nodes.length - 1];
      const x = (lastNode?.position.x ?? 100) + 50;
      const y = (lastNode?.position.y ?? 0) + 120;

      const newNode: Node = {
        id,
        type: "default",
        position: { x, y },
        data: { label: displayLabel },
        style: {
          background: "#1e293b",
          color: "#e0e0e0",
          border: `1px solid ${color}`,
          borderRadius: 8,
        },
      };

      // Auto-connect to previous node
      const newEdge: Edge | null = lastNode
        ? {
            id: `edge-${lastNode.id}-${id}`,
            source: lastNode.id,
            target: id,
            style: { stroke: color },
            animated: true,
          }
        : null;

      setNodes((prev) => [...prev, newNode]);
      if (newEdge) setEdges((prev) => [...prev, newEdge]);
      setNodeCounter((c) => c + 1);
    },
    [nodes, nodeCounter],
  );

  useImperativeHandle(ref, () => ({ addNode }), [addNode]);

  return (
    <div className="flow-pane-inner">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#2a2d3e" gap={20} />
        <Controls />
      </ReactFlow>
    </div>
  );
});
