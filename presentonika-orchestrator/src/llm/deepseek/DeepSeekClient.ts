import OpenAI from "openai";
import { sleep } from "../../util/sleep";
import type { LLMClient, LLMGenerateInput, LLMGenerateOutput } from "../LLMClient";
import { buildSystemPrompt, buildUserPrompt } from "../prompt";
import { parseAndNormalizeLLMOutput } from "../schema";
import { parseDeepseekJson } from "../parseDeepseekJson";

type ChatCompletionLike = {
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  usage?: { total_tokens?: number };
};

const extractText = (response: ChatCompletionLike): string => {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
};

export class DeepSeekClient implements LLMClient {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly repairRetries: number;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly maxOutputChars: number;
  private readonly forceBadResponse: boolean;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    });
    this.model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
    this.timeoutMs = Number.parseInt(process.env.LLM_TIMEOUT_MS || "300000", 10);
    this.maxRetries = Number.parseInt(process.env.LLM_MAX_RETRIES || "2", 10);
    this.repairRetries = Number.parseInt(process.env.LLM_JSON_REPAIR_RETRIES || "2", 10);
    this.temperature = Number.parseFloat(process.env.LLM_TEMPERATURE || "0.6");
    this.maxTokens = Number.parseInt(process.env.LLM_MAX_TOKENS || "1800", 10);
    this.maxOutputChars = Number.parseInt(process.env.LLM_MAX_OUTPUT_CHARS || "50000", 10);
    this.forceBadResponse = process.env.LLM_FORCE_BAD_RESPONSE === "true";
  }

  private async requestWithTimeout(messages: Array<{ role: "system" | "user"; content: string }>): Promise<ChatCompletionLike> {
    if (this.forceBadResponse) {
      return {
        choices: [{ message: { content: "not a json" } }],
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`LLMTimeout: ${this.timeoutMs}`)), this.timeoutMs);

    try {
      return (await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: { type: "json_object" },
        stream: false,
      }, { signal: controller.signal })) as unknown as ChatCompletionLike;
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(input: LLMGenerateInput): Promise<LLMGenerateOutput> {
    const startedAt = Date.now();
    const system = buildSystemPrompt();
    const user = buildUserPrompt(input);

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      attempt += 1;

      try {
        const response = await this.requestWithTimeout([
          { role: "system", content: system },
          { role: "user", content: user },
        ]);

        let rawText = extractText(response);
        let parsed: LLMGenerateOutput | null = null;
        let parseError: string | undefined;

        const parsedRaw = parseDeepseekJson(rawText);
        if (parsedRaw.parsed) {
          parsed = parseAndNormalizeLLMOutput({
            raw: parsedRaw.parsed,
            input,
            maxOutputChars: this.maxOutputChars,
          });
        } else {
          parseError = parsedRaw.parseError;
        }

        if (!parsed) {
          for (let repairAttempt = 1; repairAttempt <= this.repairRetries; repairAttempt += 1) {
            const repairResponse = await this.requestWithTimeout([
              { role: "system", content: `${system} Ты нарушил формат. Верни ТОЛЬКО валидный JSON по схеме без комментариев.` },
              {
                role: "user",
                content: `Ошибка: ${String(parseError || "invalid json").slice(0, 800)}\nКлючи: ${input.fillKeys.join(", ")}\nОтвет:\n${rawText.slice(0, 2000)}`,
              },
            ]);

            rawText = extractText(repairResponse);
            const repairedRaw = parseDeepseekJson(rawText);
            if (!repairedRaw.parsed) {
              parseError = repairedRaw.parseError;
              continue;
            }

            parsed = parseAndNormalizeLLMOutput({
              raw: repairedRaw.parsed,
              input,
              maxOutputChars: this.maxOutputChars,
            });
            parseError = undefined;
            break;
          }
        }

        if (!parsed) {
          throw new Error(parseError || "LLMInvalidJSON: parse failed");
        }

        return {
          ...parsed,
          meta: {
            model: this.model,
            tokens: response.usage?.total_tokens,
            latencyMs: Date.now() - startedAt,
            attempts: attempt,
            parseOk: true,
            parseError: undefined,
            rawResponseText: rawText,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt > this.maxRetries) {
          break;
        }
        await sleep(Math.min(3000, 300 * (2 ** (attempt - 1))));
      }
    }

    throw lastError ?? new Error("LLMRequestFailed");
  }
}
