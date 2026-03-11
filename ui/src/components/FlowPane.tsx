import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  NodeResizer,
  MarkerType,
  BaseEdge,
  getBezierPath,
  addEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type OnReconnect,
  type Node,
  type Edge,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import type { StageConfig } from "../utils/sqlGenerator.js";
import "@xyflow/react/dist/style.css";
import {
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useRef,
  useEffect,
} from "react";

const GEMINI_GRADIENT = "linear-gradient(135deg, #4285f4, #9c27b0)";
const GEMINI_GRADIENT_MID = "#7b52c7"; // mid-point for flat contexts (edges, markers)

const STAGE_COLORS: Record<string, string> = {
  start: "#4285f4",
  "csv-import": "#34a853",
  load: "#34a853",
  join: "#fdd835",
  union: "#ea80fc",
  filter: "#ffb300",
  group: "#f06292",
  aggregate: "#f06292",
  sort: "#26c6da",
  select: "#26a69a",
  transform: "#ea80fc",
  output: "#78909c",
  custom: GEMINI_GRADIENT_MID,
};

function getStageColor(nodeType: string): string {
  return STAGE_COLORS[nodeType.toLowerCase()] || "#9ca3af";
}

interface StageNodeData {
  stageType: string;
  label: string;
  stageIndex: number;
  tableName?: string;
  onShowTableByName?: (tableName: string) => void;
  onToggleExpand?: (nodeId: string) => void;
  expanded?: boolean;
  stageConfig?: StageConfig;
}

function StageNodeCard(props: NodeProps) {
  const { id, data: rawData } = props;
  const data = rawData as unknown as StageNodeData;
  const color = getStageColor(data.stageType);
  const isStart = data.stageType.toUpperCase() === "START";
  const isLoad = data.stageType.toUpperCase() === "LOAD";
  const tableName =
    data.tableName ??
    (isLoad && data.label.startsWith("LOAD: ")
      ? data.label.replace(/^LOAD:\s*/, "")
      : null);
  const expanded = !!data.expanded;
  const showExpand = !isStart && !isLoad;
  const config = data.stageConfig as StageConfig | undefined;

  const minWidth = expanded ? 160 : 120;
  const isCustom = data.stageType.toUpperCase() === "CUSTOM";

  return (
    <div
      className="stage-node-card"
      style={{
        background: isCustom ? GEMINI_GRADIENT : "#ffffff",
        border: isCustom ? "none" : `1.5px solid ${color}`,
        borderRadius: 6,
        padding: isCustom ? 1.5 : 5,
        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        minWidth,
        width: "100%",
        height: "100%",
        position: "relative",
      }}
    >
      {/* Inner white box for gradient-border effect on custom nodes */}
      {isCustom && (
        <div style={{
          position: "absolute",
          inset: 1.5,
          background: "#ffffff",
          borderRadius: 4.5,
          zIndex: 0,
        }} />
      )}
      <NodeResizer
        isVisible={!!props.selected}
        minWidth={minWidth}
        minHeight={30}
        lineStyle={{ border: "none" }}
        handleStyle={{ opacity: 0 }}
      />
      <Handle id="target-top" type="target" position={Position.Top} style={isStart || isLoad ? HANDLE_STYLE_PASSTHROUGH : HANDLE_STYLE} isConnectable={!isStart && !isLoad} />
      <Handle id="target-left" type="target" position={Position.Left} style={isStart || isLoad ? HANDLE_STYLE_PASSTHROUGH : HANDLE_STYLE} isConnectable={!isStart && !isLoad} />
      <Handle id="target-right" type="target" position={Position.Right} style={isStart || isLoad ? HANDLE_STYLE_PASSTHROUGH : HANDLE_STYLE} isConnectable={!isStart && !isLoad} />
      <div style={{ position: "relative", zIndex: 1, padding: isCustom ? 3.5 : 0 }}>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          minHeight: 24,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "#5f6368",
            background: "#f8f9fa",
            padding: "1px 4px",
            borderRadius: 3,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          #{data.stageIndex}
        </span>
        {isStart ? (
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <strong style={{ color, fontSize: 11 }}>{data.stageType.toUpperCase()}</strong>
          </div>
        ) : (
          <strong style={{
            fontSize: 11,
            flexShrink: 0,
            ...(isCustom
              ? { background: GEMINI_GRADIENT, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontWeight: 700 }
              : { color }),
          }}>
            {data.stageType.toUpperCase()}
          </strong>
        )}
        {tableName && !isStart && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              data.onShowTableByName?.(tableName);
            }}
            style={{
              fontSize: 10,
              color: "#4285f4",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: expanded ? 90 : 60,
            }}
            title={`Show table ${tableName}`}
          >
            {tableName}
          </button>
        )}
        {showExpand && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              data.onToggleExpand?.(id);
            }}
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 2,
              display: "flex",
              color: "#5f6368",
            }}
            title={expanded ? "Collapse" : "Expand"}
          >
            <span style={{ transform: expanded ? "rotate(180deg)" : "none", display: "inline-block" }}>▾</span>
          </button>
        )}
      </div>

      {expanded && (config || isCustom) && (
        <div className="stage-node-details" style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #e8eaed", fontSize: 10, color: "#5f6368" }}>
          {config?.type?.toUpperCase() === "JOIN" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div><strong>Left:</strong> {config.leftTable} → {config.leftKey}</div>
              <div><strong>Right:</strong> {config.rightTable} → {config.rightKey}</div>
              {config.joinType && <div><strong>Type:</strong> {config.joinType}</div>}
            </div>
          )}
          {config?.type?.toUpperCase() === "UNION" && (
            <div>
              <strong>Tables:</strong> {(config.unionTables ?? []).join(", ")}
              {config.unionType && ` (${config.unionType})`}
            </div>
          )}
          {config?.type?.toUpperCase() === "FILTER" && (
            <div>
              <strong>Where:</strong> {config.table}.{config.column} {config.operator} {String(config.value)}
            </div>
          )}
          {config?.type?.toUpperCase() === "GROUP" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div><strong>Table:</strong> {config.groupTable}</div>
              <div><strong>Group by:</strong> {(config.groupByColumns ?? []).join(", ")}</div>
              {(config.aggregations?.length ?? 0) > 0 && (
                <div><strong>Agg:</strong> {config.aggregations!.map((a: { fn: string; column: string }) => `${a.fn}(${a.column})`).join(", ")}</div>
              )}
            </div>
          )}
          {config?.type?.toUpperCase() === "SELECT" && (
            <div>
              <strong>Columns:</strong> {(config.selectColumns ?? []).join(", ")}
            </div>
          )}
          {config?.type?.toUpperCase() === "SORT" && (
            <div>
              <strong>Order by:</strong> {config.sortTable}.{config.sortColumn} {config.sortDirection}
            </div>
          )}
          {isCustom && (
            <div style={{ wordBreak: "break-all" }}>
              {config?.sql ? (
                <><strong>SQL:</strong> {config.sql.slice(0, 80)}{config.sql.length > 80 ? "…" : ""}</>
              ) : (
                <span style={{ fontStyle: "italic", color: "#9aa0a6" }}>No SQL defined — double-click to configure</span>
              )}
            </div>
          )}
        </div>
      )}

      </div>{/* end inner z-1 wrapper */}
      <Handle id="source-bottom" type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

const HANDLE_STYLE = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  border: "1px solid #9ca3af",
  background: "#ffffff",
};

const HANDLE_STYLE_PASSTHROUGH = {
  ...HANDLE_STYLE,
  pointerEvents: "none" as const,
};

const nodeTypes = { stage: StageNodeCard };

/* ─── Custom gradient bezier edge ─── */

function GradientEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const gradientId = `edge-grad-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const srcColor = (data?.sourceColor as string) || "#9ca3af";
  const tgtColor = (data?.targetColor as string) || "#9ca3af";

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={srcColor} />
          <stop offset="100%" stopColor={tgtColor} />
        </linearGradient>
      </defs>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: `url(#${gradientId})`, strokeWidth: 2 }}
      />
    </>
  );
}

const edgeTypes = { gradient: GradientEdge };

/* ─── Gradient dashed connection line (while dragging) ─── */

function GradientConnectionLine(props: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromPosition: Position;
  toPosition: Position;
  fromNode?: Node;
}) {
  const { fromX, fromY, toX, toY, fromPosition, toPosition, fromNode } = props;
  const srcData = fromNode?.data as StageNodeData | undefined;
  const srcColor = srcData ? getStageColor(String(srcData.stageType ?? "custom")) : "#9ca3af";

  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    targetX: toX,
    targetY: toY,
    sourcePosition: fromPosition,
    targetPosition: toPosition || Position.Top,
  });

  return (
    <g>
      <defs>
        <linearGradient
          id="conn-line-grad"
          x1={fromX}
          y1={fromY}
          x2={toX}
          y2={toY}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={srcColor} />
          <stop offset="100%" stopColor="#9ca3af" />
        </linearGradient>
      </defs>
      <path
        d={path}
        fill="none"
        stroke="url(#conn-line-grad)"
        strokeWidth={2}
        strokeDasharray="8 4"
      />
    </g>
  );
}

/* ─── Add Stage menu options ─── */

const STAGE_OPTIONS = [
  { type: "JOIN", label: "Join", color: "#fdd835" },
  { type: "UNION", label: "Union", color: "#ea80fc" },
  { type: "FILTER", label: "Filter", color: "#ffb300" },
  { type: "GROUP", label: "Group", color: "#f06292" },
  { type: "SELECT", label: "Select", color: "#26a69a" },
  { type: "SORT", label: "Sort", color: "#26c6da" },
  { type: "CUSTOM", label: "Custom SQL", color: GEMINI_GRADIENT_MID, gradient: true },
];

/* ─── Constants ─── */

const initialNodes: Node[] = [
  {
    id: "start",
    type: "stage",
    position: { x: 100, y: 10 },
    data: { stageType: "START", label: "", stageIndex: 0 },
    deletable: false,
  },
];

const initialEdges: Edge[] = [];

/* ─── Exports / types ─── */

export interface FlowPaneHandle {
  addNode: (
    nodeType: string,
    label?: string,
    options?: { tableName?: string; sourceIds?: string[]; deferEdges?: boolean },
  ) => string | null;
  updateNodeData: (nodeId: string, updates: Record<string, unknown>) => void;
  connectNode: (nodeId: string, sourceTableNames?: string[]) => void;
  removeNodeByTableName: (tableName: string) => boolean;
}

export interface FlowSnapshot {
  nodes: Array<{
    id: string;
    stageType: string;
    label: string;
    x: number;
    y: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}

interface FlowPaneProps {
  onFlowChange?: (snapshot: FlowSnapshot) => void;
  onShowTableByName?: (tableName: string) => void;
  onConfigureStage?: (nodeId: string, stageType: string) => void;
  onNodeDeleted?: (nodeId: string, stageType: string) => void;
}

/* ─── Helpers ─── */

function getNodeColor(nodeId: string, nodes: Node[]): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return "#9ca3af";
  const stageType = String(
    (node.data as unknown as Partial<StageNodeData>)?.stageType ?? "custom",
  );
  return getStageColor(stageType);
}

function buildEdge(
  id: string,
  source: string,
  target: string,
  nodes: Node[],
): Edge {
  return {
    id,
    source,
    target,
    type: "gradient",
    animated: false,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: getNodeColor(target, nodes),
    },
    data: {
      sourceColor: getNodeColor(source, nodes),
      targetColor: getNodeColor(target, nodes),
    },
  };
}

/* ─── Component ─── */

/** Helper rendered inside <ReactFlow> to trigger fitView when nodes are added */
function FitViewOnChange({ trigger }: { trigger: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (trigger === 0) return;
    // Small delay so React Flow processes new nodes before fitting
    const t = setTimeout(() => fitView({ padding: 0.3, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [trigger, fitView]);
  return null;
}

function FlowPaneInner(
  { onFlowChange, onShowTableByName, onConfigureStage, onNodeDeleted }: FlowPaneProps,
  ref: React.ForwardedRef<FlowPaneHandle>,
) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const idRef = useRef(1);
  const fitTriggerRef = useRef(0);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [showStageMenu, setShowStageMenu] = useState(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const onToggleExpand = useCallback((nodeId: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, expanded: !(n.data as unknown as StageNodeData).expanded } }
          : n,
      ),
    );
  }, [setNodes]);

  // Keep gradient colours in sync whenever nodes change
  useEffect(() => {
    setEdges((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        const srcColor = getNodeColor(e.source, nodes);
        const tgtColor = getNodeColor(e.target, nodes);
        const d = e.data as Record<string, unknown> | undefined;
        const marker = e.markerEnd as { type: MarkerType; color?: string } | undefined;
        if (
          d?.sourceColor === srcColor &&
          d?.targetColor === tgtColor &&
          e.type === "gradient" &&
          marker?.color === tgtColor
        ) {
          return e;
        }
        changed = true;
        return {
          ...e,
          type: "gradient" as const,
          markerEnd: { type: MarkerType.ArrowClosed, color: tgtColor },
          data: { ...d, sourceColor: srcColor, targetColor: tgtColor },
        };
      });
      return changed ? next : prev;
    });
  }, [nodes, setEdges]);

  useEffect(() => {
    onFlowChange?.({
      nodes: nodes.map((n) => {
        const d = n.data as unknown as Partial<StageNodeData>;
        return {
          id: n.id,
          stageType: String(d.stageType ?? "custom"),
          label: String(d.label ?? ""),
          x: n.position.x,
          y: n.position.y,
        };
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    });
  }, [nodes, edges, onFlowChange]);

  const addNode = useCallback(
    (nodeType: string, label?: string, options?: { tableName?: string; sourceIds?: string[]; deferEdges?: boolean }): string | null => {
      const displayLabel = label || nodeType;
      const normalized = nodeType.toLowerCase();
      const derivedTableName =
        options?.tableName ??
        (normalized === "load" && displayLabel.startsWith("LOAD: ")
          ? displayLabel.replace(/^LOAD:\s*/, "")
          : undefined);

      // Dedup: if a node with this tableName already exists, skip
      if (derivedTableName) {
        const existing = nodesRef.current.find((n) => {
          const d = n.data as unknown as StageNodeData;
          return d.tableName === derivedTableName;
        });
        if (existing) return null;
      }

      const id = `node-${idRef.current++}`;
      const isLoad = normalized === "load" || normalized === "csv-import";
      const multiInput = normalized === "join" || normalized === "union";
      const skipEdges = !!options?.deferEdges;

      setNodes((prevNodes) => {
        // Determine source nodes for edges (only when not deferred)
        let sourceNodes: Node[] = [];

        if (!skipEdges) {
          if (options?.sourceIds?.length) {
            sourceNodes = options.sourceIds
              .map((sid) => prevNodes.find((n) => n.id === sid))
              .filter((n): n is Node => !!n);
          } else if (multiInput) {
            const dataNonStart = prevNodes.filter((n) => n.id !== "start");
            if (dataNonStart.length >= 2) {
              sourceNodes = dataNonStart.slice(-2);
            } else if (dataNonStart.length === 1) {
              sourceNodes = dataNonStart;
            }
          } else if (isLoad) {
            const startNode = prevNodes.find((n) => n.id === "start");
            if (startNode) sourceNodes = [startNode];
          } else {
            const lastNode = prevNodes[prevNodes.length - 1];
            if (lastNode) sourceNodes = [lastNode];
          }
        }

        // Position
        let x: number, y: number;
        if (multiInput && sourceNodes.length >= 2) {
          // Center between the two source nodes
          const xs = sourceNodes.map((n) => n.position.x);
          const ys = sourceNodes.map((n) => n.position.y);
          x = (Math.min(...xs) + Math.max(...xs)) / 2;
          y = Math.max(...ys) + 140;
        } else if (isLoad) {
          // Fan LOAD nodes symmetrically below their parent (START)
          const parent = sourceNodes[0] ?? prevNodes.find((n) => n.id === "start");
          const parentX = parent?.position.x ?? 100;
          const parentY = parent?.position.y ?? 10;
          const siblingLoads = prevNodes.filter((n) => {
            const st = String((n.data as unknown as Partial<StageNodeData>)?.stageType ?? "").toLowerCase();
            return st === "load" || st === "csv-import";
          });
          const count = siblingLoads.length; // 0-based index for this new one
          const SPREAD = 200;
          // 0 → left (-100), 1 → right (+100), 2 → further left (-300), 3 → further right (+300), ...
          const tier = Math.floor(count / 2) + 1; // 1, 1, 2, 2, 3, ...
          const sign = count % 2 === 0 ? -1 : 1; // left first, then right
          x = parentX + sign * tier * (SPREAD / 2);
          y = parentY + 120;
        } else if (sourceNodes.length === 1) {
          // Place directly below the single source
          x = sourceNodes[0].position.x;
          y = sourceNodes[0].position.y + 140;
        } else {
          // Deferred or no source — place below the last node, centered
          const lastNode = prevNodes[prevNodes.length - 1];
          x = lastNode?.position.x ?? 100;
          y = (lastNode?.position.y ?? 0) + 140;
        }

        const newNode: Node = {
          id,
          type: "stage",
          position: { x, y },
          deletable: isLoad ? false : undefined,
          data: {
            stageType: nodeType,
            label: displayLabel,
            stageIndex: prevNodes.length,
            tableName: derivedTableName,
            onShowTableByName,
            onToggleExpand,
            expanded: false,
          },
        };

        const allNodes = [...prevNodes, newNode];

        if (sourceNodes.length > 0) {
          const newEdges = sourceNodes.map((src) =>
            buildEdge(`edge-${src.id}-${id}`, src.id, id, allNodes),
          );
          setEdges((prevEdges) => [...prevEdges, ...newEdges]);
        }

        return allNodes;
      });

      setFitTrigger(++fitTriggerRef.current);
      return id;
    },
    [setNodes, setEdges, onShowTableByName, onToggleExpand],
  );

  const updateNodeData = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n,
        ),
      );
    },
    [setNodes],
  );

  const connectNode = useCallback(
    (nodeId: string, sourceTableNames?: string[]) => {
      const currentNodes = nodesRef.current;
      const targetNode = currentNodes.find((n) => n.id === nodeId);
      if (!targetNode) return;

      let sourceNodes: Node[] = [];
      if (sourceTableNames?.length) {
        for (const tn of sourceTableNames) {
          const found = currentNodes.find((n) => {
            const d = n.data as unknown as StageNodeData;
            return d.tableName === tn;
          });
          if (found) sourceNodes.push(found);
        }
      }

      if (sourceNodes.length === 0) {
        const idx = currentNodes.indexOf(targetNode);
        if (idx > 0) sourceNodes = [currentNodes[idx - 1]];
      }

      if (sourceNodes.length > 0) {
        // Reposition before adding edges: if the primary source already has downstream
        // children, place the new node to the right instead of directly below (avoids overlap)
        setEdges((prevEdges) => {
          if (sourceNodes.length === 1) {
            const src = sourceNodes[0];
            const alreadyHasChild = prevEdges.some(
              (e) => e.source === src.id && e.target !== nodeId,
            );
            if (alreadyHasChild) {
              // Find the rightmost X of all existing nodes, then add a column gap
              const maxX = Math.max(...currentNodes.map((n) => n.position.x));
              const newX = maxX + 220;
              const newY = src.position.y + 140;
              setNodes((prev) =>
                prev.map((n) =>
                  n.id === nodeId ? { ...n, position: { x: newX, y: newY } } : n,
                ),
              );
            }
          }
          const newEdges = sourceNodes.map((src) =>
            buildEdge(`edge-${src.id}-${nodeId}-${Date.now()}`, src.id, nodeId, currentNodes),
          );
          return [...prevEdges, ...newEdges];
        });
      }
    },
    [setEdges, setNodes],
  );

  const removeNodeByTableName = useCallback(
    (tableName: string): boolean => {
      const currentNodes = nodesRef.current;
      const node = currentNodes.find((n) => {
        const d = n.data as unknown as StageNodeData;
        return d.tableName === tableName;
      });
      if (!node) return false;
      const nodeId = node.id;
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
      return true;
    },
    [setNodes, setEdges],
  );

  const handleBeforeDelete = useCallback(
    async ({ nodes: toDelete }: { nodes: Node[]; edges: Edge[] }) => {
      if (toDelete.length === 0) return true;
      const names = toDelete
        .map((n) => (n.data as unknown as StageNodeData).stageType.toUpperCase())
        .join(", ");
      return window.confirm(
        `Delete ${toDelete.length} stage${toDelete.length > 1 ? "s" : ""} (${names})?`,
      );
    },
    [],
  );

  const handleDelete = useCallback(
    ({ nodes: deleted }: { nodes: Node[]; edges: Edge[] }) => {
      for (const n of deleted) {
        const d = n.data as unknown as StageNodeData;
        onNodeDeleted?.(n.id, d.stageType);
      }
    },
    [onNodeDeleted],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const targetNode = nodes.find((n) => n.id === connection.target);
      const targetType = String(
        (targetNode?.data as StageNodeData | undefined)?.stageType ?? "",
      ).toLowerCase();

      if (
        (targetType === "load" || targetType === "csv-import") &&
        connection.source !== "start"
      ) {
        return;
      }

      // Avoid duplicate when React Flow fires both onReconnect and onConnect for the same connection
      setEdges((prev) => {
        const alreadyExists = prev.some(
          (e) => e.source === connection.source && e.target === connection.target,
        );
        if (alreadyExists) return prev;
        const newEdge = buildEdge(
          `edge-${connection.source}-${connection.target}-${Date.now()}`,
          connection.source,
          connection.target,
          nodes,
        );
        return addEdge({ ...connection, ...newEdge }, prev);
      });
    },
    [nodes, setEdges],
  );

  const onEdgeDoubleClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      setEdges((prev) => prev.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  const onReconnect = useCallback<OnReconnect>(
    (oldEdge, newConnection) => {
      if (!newConnection.source || !newConnection.target) return;
      const targetNode = nodes.find((n) => n.id === newConnection.target);
      const targetType = String(
        (targetNode?.data as StageNodeData | undefined)?.stageType ?? "",
      ).toLowerCase();
      if (
        (targetType === "load" || targetType === "csv-import") &&
        newConnection.source !== "start"
      ) {
        return;
      }
      setEdges((prev) => reconnectEdge(oldEdge, newConnection, prev));
    },
    [nodes, setEdges],
  );

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as unknown as StageNodeData;
      const type = data.stageType.toUpperCase();
      if (type === "START" || type === "LOAD") return;
      onConfigureStage?.(node.id, data.stageType);
    },
    [onConfigureStage],
  );

  const handleAddStage = useCallback(
    (type: string) => {
      setShowStageMenu(false);
      const nodeId = addNode(type, type, { deferEdges: true });
      if (nodeId) onConfigureStage?.(nodeId, type);
    },
    [addNode, onConfigureStage],
  );

  useImperativeHandle(ref, () => ({ addNode, updateNodeData, connectNode, removeNodeByTableName }), [addNode, updateNodeData, connectNode, removeNodeByTableName]);

  return (
    <div className="flow-pane-inner">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onBeforeDelete={handleBeforeDelete}
        onDelete={handleDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionLineComponent={GradientConnectionLine as any}
        fitView
        fitViewOptions={{ padding: 1.5 }}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        edgesReconnectable
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
      >
        <FitViewOnChange trigger={fitTrigger} />
        <Background color="#dadce0" gap={20} />
        <Controls />
        <Panel position="bottom-right" style={{ margin: 12 }}>
          <div style={{ position: "relative" }}>
            {showStageMenu && (
              <div className="stage-menu">
                {STAGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    className="stage-menu-item"
                    onClick={() => handleAddStage(opt.type)}
                  >
                    <span
                      className="stage-dot"
                      style={{ background: (opt as any).gradient ? GEMINI_GRADIENT : opt.color }}
                    />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            <button
              className="add-stage-btn"
              onClick={() => setShowStageMenu((v) => !v)}
            >
              + Add Stage
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

const FlowPaneWithRef = forwardRef<FlowPaneHandle, FlowPaneProps>(FlowPaneInner);

export default forwardRef<FlowPaneHandle, FlowPaneProps>(function FlowPane(props, ref) {
  return (
    <ReactFlowProvider>
      <FlowPaneWithRef ref={ref} {...props} />
    </ReactFlowProvider>
  );
});
