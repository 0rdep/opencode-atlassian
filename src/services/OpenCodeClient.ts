import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"

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
  readonly sessionId: string
  readonly completed: boolean
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
    workDir: string
    prompt: string
    modelId?: string
    providerId?: string
  }) => Effect.Effect<OpenCodeResult, OpenCodeError>
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
const DEFAULT_MODEL_ID = "claude-sonnet-4-20250514"
const DEFAULT_PROVIDER_ID = "anthropic"

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
        try: () => client.session.create(),
        catch: (error) =>
          new OpenCodeError({
            message: `Failed to create OpenCode session: ${error}`,
            cause: error,
          }),
      })

      if (sessionResult.error) {
        return yield* Effect.fail(
          new OpenCodeError({
            message: `Failed to create OpenCode session: ${JSON.stringify(sessionResult.error)}`,
          })
        )
      }

      const session = sessionResult.data!
      yield* Effect.log(`Created OpenCode session: ${session.id}`)

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
      })

      if (response.error) {
        return yield* Effect.fail(
          new OpenCodeError({
            message: `OpenCode prompt failed: ${JSON.stringify(response.error)}`,
          })
        )
      }

      yield* Effect.log(
        `OpenCode completed. Message ID: ${response.data?.info?.id}`
      )

      return {
        sessionId: session.id,
        completed: true,
      }
    }),
})

/**
 * Layer that provides the OpenCodeClient service
 * Creates the client during layer construction
 */
export const OpenCodeClientLive: Layer.Layer<OpenCodeClientService> =
  Layer.sync(OpenCodeClientService, () => {
    // Create the OpenCode SDK client
    // It will use OPENCODE_BASE_URL env var or default to localhost:54321
    const client = createOpencodeClient()
    return makeOpenCodeClientService(client)
  })
