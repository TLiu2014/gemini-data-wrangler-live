import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../ws.js";
import { Type, type FunctionDeclaration } from "@google/genai";

// ---------------------------------------------------------------------------
// Agent actions sent to the frontend
// ---------------------------------------------------------------------------

export interface AddNodeAction {
  action: "ADD_NODE";
  nodeType: string;
  label?: string;
}

export interface ExecuteSqlAction {
  action: "EXECUTE_SQL";
  sql: string;
  description: string;
}

export interface RenderChartAction {
  action: "RENDER_CHART";
  chartType: string;
  xKey: string;
  yKey: string;
}

export type AgentAction = AddNodeAction | ExecuteSqlAction | RenderChartAction;

// ---------------------------------------------------------------------------
// Tool declarations for Gemini function calling
// ---------------------------------------------------------------------------

export function getToolDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "addReactFlowNode",
      description:
        "Add a new node to the data pipeline graph. Use this when the user wants to add a step like importing CSV, filtering, transforming, or outputting data.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          nodeType: {
            type: Type.STRING,
            enum: ["csv-import", "filter", "transform", "output"],
            description: "The type of pipeline node to add",
          },
          label: {
            type: Type.STRING,
            description: "Display label for the node",
          },
        },
        required: ["nodeType"],
      },
    },
    {
      name: "executeDataTransform",
      description:
        "Generate and execute a SQL query against the user's data in DuckDB. Use this for filtering, cleaning, aggregating, or any data manipulation the user requests.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          sql: {
            type: Type.STRING,
            description: "The SQL query to execute (DuckDB dialect)",
          },
          description: {
            type: Type.STRING,
            description: "Human-readable description of what this query does",
          },
        },
        required: ["sql", "description"],
      },
    },
    {
      name: "renderChart",
      description:
        "Render a chart visualization from the current data. Use when the user asks to graph, plot, or visualize data.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          chartType: {
            type: Type.STRING,
            enum: ["bar", "line", "pie"],
            description: "Type of chart to render",
          },
          xKey: {
            type: Type.STRING,
            description: "Column name for the x-axis",
          },
          yKey: {
            type: Type.STRING,
            description: "Column name for the y-axis / values",
          },
        },
        required: ["chartType", "xKey", "yKey"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Handle tool calls from Gemini and dispatch actions to the frontend
// ---------------------------------------------------------------------------

export function handleToolCall(
  socket: WebSocket,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "addReactFlowNode": {
      const action: AddNodeAction = {
        action: "ADD_NODE",
        nodeType: args.nodeType as string,
        label: args.label as string | undefined,
      };
      sendActionToClient(socket, action);
      return { success: true, nodeType: action.nodeType };
    }

    case "executeDataTransform": {
      const action: ExecuteSqlAction = {
        action: "EXECUTE_SQL",
        sql: args.sql as string,
        description: args.description as string,
      };
      const msg: WsMessage = { type: "sql", payload: action };
      socket.send(JSON.stringify(msg));
      return { success: true, sql: action.sql };
    }

    case "renderChart": {
      const action: RenderChartAction = {
        action: "RENDER_CHART",
        chartType: args.chartType as string,
        xKey: args.xKey as string,
        yKey: args.yKey as string,
      };
      sendActionToClient(socket, action);
      return { success: true, chartType: action.chartType };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function sendActionToClient(socket: WebSocket, action: AgentAction): void {
  const msg: WsMessage = { type: "action", payload: action };
  socket.send(JSON.stringify(msg));
}
