import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { Duration } from "effect";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";

/**
 * OpenCode operation errors
 */
export class OpenCodeError extends Schema.TaggedError<OpenCodeError>()(
  "OpenCodeError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

/**
 * Result of running OpenCode on a task
 */
export interface OpenCodeResult {
  readonly sessionId: string;
  readonly completed: boolean;
}

/**
 * OpenCode client service interface
 */
export interface OpenCodeClientI {
  /**
   * Run OpenCode to work on a task in the given directory
   * Returns when the task is complete
   */
  readonly runTask: (params: {
    workDir: string;
    prompt: string;
    modelId?: string;
    providerId?: string;
  }) => Effect.Effect<OpenCodeResult, OpenCodeError>;
}

/**
 * OpenCode client service tag
 */
export class OpenCodeClientService extends Context.Tag("OpenCodeClient")<
  OpenCodeClientService,
  OpenCodeClientI
>() {}

/**
 * Default model and provider configuration
 */
const DEFAULT_MODEL_ID = "claude-opus-4.5";
const DEFAULT_PROVIDER_ID = "github-copilot";

/**
 * Polling configuration
 */
const POLL_INTERVAL = Duration.seconds(2);
const MAX_POLL_DURATION = Duration.minutes(30);

/**
 * Create the OpenCode client service implementation
 */
const makeOpenCodeClientService = (
  client: OpencodeClient
): OpenCodeClientI => ({
  runTask: ({ workDir, prompt, modelId, providerId }) =>
    Effect.gen(function* () {
      // Create a new session
      const sessionResult = yield* Effect.tryPromise({
        try: () =>
          client.session.create({
            query: {
              directory: workDir,
            },
          }),
        catch: (error) =>
          new OpenCodeError({
            message: `Failed to create OpenCode session: ${error}`,
            cause: error,
          }),
      });

      if (sessionResult.error) {
        return yield* Effect.fail(
          new OpenCodeError({
            message: `Failed to create OpenCode session: ${JSON.stringify(
              sessionResult.error
            )}`,
          })
        );
      }

      const session = sessionResult.data!;
      yield* Effect.log(`Created OpenCode session: ${session.id}`);

      // Send the prompt to the session using prompt method
      const response = yield* Effect.tryPromise({
        try: () =>
          client.session.prompt({
            path: {
              id: session.id,
            },
            query: {
              directory: workDir,
            },
            body: {
              model: {
                providerID: providerId ?? DEFAULT_PROVIDER_ID,
                modelID: modelId ?? DEFAULT_MODEL_ID,
              },
              parts: [
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          }),
        catch: (error) =>
          new OpenCodeError({
            message: `Failed to run OpenCode prompt: ${error}`,
            cause: error,
          }),
      });

      if (response.error) {
        return yield* Effect.fail(
          new OpenCodeError({
            message: `OpenCode prompt failed: ${JSON.stringify(
              response.error
            )}`,
          })
        );
      }

      yield* Effect.log(
        `OpenCode prompt sent. Message ID: ${response.data?.info?.id}. Polling for completion...`
      );

      // Poll session status until it becomes idle
      const pollStatus = Effect.gen(function* () {
        const statusResult = yield* Effect.tryPromise({
          try: () =>
            client.session.status({
              query: {
                directory: workDir,
              },
            }),
          catch: (error) =>
            new OpenCodeError({
              message: `Failed to get session status: ${error}`,
              cause: error,
            }),
        });

        if (statusResult.error) {
          return yield* Effect.fail(
            new OpenCodeError({
              message: `Failed to get session status: ${JSON.stringify(
                statusResult.error
              )}`,
            })
          );
        }

        const statuses = statusResult.data ?? {};
        const sessionStatus = statuses[session.id];

        if (!sessionStatus) {
          // Session not found in status - assume idle
          yield* Effect.log(`Session ${session.id} not in status, assuming idle`);
          return "idle" as const;
        }

        yield* Effect.log(
          `Session ${session.id} status: ${sessionStatus.type}`
        );

        if (sessionStatus.type === "idle") {
          return "idle" as const;
        }

        // Still busy or retrying - fail to trigger retry
        return yield* Effect.fail(
          new OpenCodeError({
            message: `Session still ${sessionStatus.type}`,
          })
        );
      });

      // Retry polling until session is idle or timeout
      const schedule = Schedule.spaced(POLL_INTERVAL).pipe(
        Schedule.upTo(MAX_POLL_DURATION)
      );

      yield* pollStatus.pipe(
        Effect.retry(schedule),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.log(
              `Polling timeout or error: ${error.message}. Checking final status...`
            );
            // One final check
            const finalStatusResult = yield* Effect.tryPromise({
              try: () =>
                client.session.status({
                  query: {
                    directory: workDir,
                  },
                }),
              catch: (err) =>
                new OpenCodeError({
                  message: `Failed to get final session status: ${err}`,
                  cause: err,
                }),
            });
            const finalStatuses = finalStatusResult?.data ?? {};
            const finalStatus = finalStatuses[session.id];
            if (finalStatus?.type === "idle") {
              return "idle" as const;
            }
            return yield* Effect.fail(error);
          })
        )
      );

      yield* Effect.log(`OpenCode session ${session.id} completed (idle)`);

      return {
        sessionId: session.id,
        completed: true,
      };
    }),
});

/**
 * Layer that provides the OpenCodeClient service
 * Creates the client during layer construction
 */
export const OpenCodeClientLive: Layer.Layer<OpenCodeClientService> =
  Layer.sync(OpenCodeClientService, () => {
    // Create the OpenCode SDK client
    // It will use OPENCODE_BASE_URL env var or default to localhost:54321
    const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" });
    return makeOpenCodeClientService(client);
  });
