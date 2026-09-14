import { CreateMLCEngine, type MLCEngineInterface } from "@mlc-ai/web-llm";

/**
 * Vision service using MLCEngine for screen analysis
 * Converts Playwright events + screenshots to rich natural language descriptions
 */

export interface RecordedAction {
  type: "click" | "fill" | "navigate" | "screenshot" | "wait" | "scroll";
  target?: string;
  value?: string;
  coordinates?: { x: number; y: number };
  screenshot?: string; // base64 or data URL
  timestamp: number;
}

export interface EnhancedDescription {
  description: string;
  confidence: number;
  details: string;
}

const DEFAULT_VISION_MODEL = "Phi-3.5-vision-instruct-q4f32_1-MLC";

class VisionService {
  private engine: MLCEngineInterface | null = null;
  private modelId: string;
  private initialized = false;

  constructor(modelId: string = DEFAULT_VISION_MODEL) {
    this.modelId = modelId;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      ensureWebLLMRuntimeGlobals();
      this.engine = await CreateMLCEngine(this.modelId, {
        temperature: 0.7,
        top_p: 0.95,
      });
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize vision model:", error);
      throw new Error(`Vision model initialization failed: ${error}`);
    }
  }

  async analyzeScreenshot(imageData: string): Promise<string> {
    if (!this.engine) {
      await this.initialize();
    }

    try {
      const messages = [
        {
          role: "user" as const,
          content: [
            {
              type: "image_url" as const,
              image_url: {
                url: imageData, // data:image/png;base64,...
              },
            },
            {
              type: "text" as const,
              text: "Describe what you see on this screen in 2-3 concise sentences. Focus on: visible UI elements, form fields, buttons, text, navigation state.",
            },
          ],
        },
      ];

      const response = await (this.engine as any).chat.completions.create({
        messages,
        max_tokens: 150,
      });

      return (
        response.choices[0].message.content ||
        "Unable to analyze screenshot"
      );
    } catch (error) {
      console.error("Screenshot analysis failed:", error);
      return "Unable to analyze screenshot";
    }
  }

  async generateRecordingDescription(actions: RecordedAction[]): Promise<string> {
    if (!this.engine) {
      await this.initialize();
    }

    const actionSummary = actions
      .map((action) => {
        if (action.type === "click") {
          return `Click on: ${action.target || "element at " + JSON.stringify(action.coordinates)}`;
        } else if (action.type === "fill") {
          return `Type: "${action.value}" into ${action.target || "field"}`;
        } else if (action.type === "navigate") {
          return `Navigate to: ${action.value}`;
        } else if (action.type === "screenshot") {
          return "Capture screenshot";
        } else if (action.type === "wait") {
          return `Wait ${action.value || "for element"}`;
        } else if (action.type === "scroll") {
          return `Scroll ${action.value || "page"}`;
        }
        return `Perform: ${action.type}`;
      })
      .join("\n");

    // Get screenshot context if available
    let screenContext = "";
    const lastScreenshot = actions.find((a) => a.screenshot && a.type === "screenshot");
    if (lastScreenshot?.screenshot) {
      try {
        screenContext = await this.analyzeScreenshot(lastScreenshot.screenshot);
      } catch (error) {
        console.error("Failed to analyze final screenshot:", error);
      }
    }

    try {
      const prompt = `Based on these user actions and the final screen state, generate a concise natural language test description (1-2 sentences).

Actions performed:
${actionSummary}

Final screen state:
${screenContext || "Unknown"}

Generate a single sentence that describes what test should do, not HOW it does it. Start with an action verb like "Login", "Search", "Create", etc.`;

      const response = await (this.engine as any).chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100,
      });

      return (
        response.choices[0].message.content ||
        "Replay recorded actions"
      );
    } catch (error) {
      console.error("Description generation failed:", error);
      // Fallback to simple description
      return this.generateSimpleDescription(actions);
    }
  }

  private generateSimpleDescription(actions: RecordedAction[]): string {
    const verbs = actions
      .filter((a) => a.type === "click")
      .map((a) => "click")
      .slice(0, 2);
    const hasFill = actions.some((a) => a.type === "fill");
    const hasNavigate = actions.some((a) => a.type === "navigate");

    let desc = "";
    if (hasNavigate) desc += "Navigate and ";
    if (verbs.length > 0) desc += verbs.join(", ") + " ";
    if (hasFill) desc += "fill fields ";
    if (!desc) desc = "Replay recorded actions";

    return desc.trim();
  }

  async close(): Promise<void> {
    if (this.engine) {
      try {
        await (this.engine as any).finish();
      } catch (error) {
        console.error("Error closing vision engine:", error);
      }
    }
    this.initialized = false;
  }
}

function ensureWebLLMRuntimeGlobals() {
  const globalObject = globalThis as typeof globalThis & {
    caches?: CacheStorage;
    location?: Location;
  };
  if (!globalObject.location) {
    globalObject.location = new URL("http://localhost") as unknown as Location;
  }
  if (!globalObject.caches) {
    const stores = new Map<string, Map<string, Response>>();
    globalObject.caches = {
      async open(name: string) {
        let store = stores.get(name);
        if (!store) {
          store = new Map<string, Response>();
          stores.set(name, store);
        }
        return {
          async match(request: RequestInfo | URL) {
            const response = store.get(new Request(request).url);
            return response || null;
          },
          async put(request: RequestInfo | URL, response: Response) {
            store.set(new Request(request).url, response.clone());
          },
          async delete(request: RequestInfo | URL) {
            return store.delete(new Request(request).url);
          },
        } as any;
      },
      async delete(name: string) {
        return stores.delete(name);
      },
      async keys() {
        return Array.from(stores.keys());
      },
      async match(request: RequestInfo | URL) {
        for (const store of stores.values()) {
          const response = store.get(new Request(request).url);
          if (response) return response;
        }
        return null;
      },
      async has(name: string) {
        return stores.has(name);
      },
    } as any;
  }
}

export { VisionService };
export const createVisionService = (modelId?: string) => new VisionService(modelId);
