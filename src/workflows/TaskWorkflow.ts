import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Console from "effect/Console"
import { Workflow, Activity, WorkflowEngine } from "@effect/workflow"
import { Database } from "../services/Database.ts"
import { JiraClient } from "../services/JiraClient.ts"
import { GitService, GitError } from "../services/GitService.ts"
import {
  OpenCodeClientService,
  OpenCodeError,
} from "../services/OpenCodeClient.ts"
import { AtlassianConfigService } from "../config/Config.ts"
import type { JiraIssue, JiraComment } from "../schema/JiraIssue.ts"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Task workflow error
 */
export class TaskWorkflowError extends Schema.TaggedError<TaskWorkflowError>()(
  "TaskWorkflowError",
  {
    message: Schema.String,
    phase: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  }
) {}

/**
 * Task workflow payload
 */
export const TaskWorkflowPayload = {
  taskId: Schema.Number,
  jiraKey: Schema.String,
  jiraData: Schema.String, // JSON string of JiraIssue
}

/**
 * Task workflow success result
 */
export const TaskWorkflowSuccess = Schema.Struct({
  sessionId: Schema.String,
  branchName: Schema.String,
})

/**
 * The main task workflow definition
 */
export const TaskWorkflow = Workflow.make({
  name: "ProcessTask",
  payload: TaskWorkflowPayload,
  success: TaskWorkflowSuccess,
  error: TaskWorkflowError,
  idempotencyKey: ({ taskId }) => `task-${taskId}`,
})

/**
 * Convert ADF (Atlassian Document Format) to plain text
 * This is a simplified converter that extracts text content
 */
const adfToText = (adf: unknown): string => {
  if (!adf || typeof adf !== "object") return ""

  const doc = adf as { content?: unknown[] }
  if (!doc.content || !Array.isArray(doc.content)) return ""

  const extractText = (node: unknown): string => {
    if (!node || typeof node !== "object") return ""
    const n = node as { type?: string; text?: string; content?: unknown[] }

    if (n.type === "text" && n.text) {
      return n.text
    }

    if (n.content && Array.isArray(n.content)) {
      return n.content.map(extractText).join("")
    }

    return ""
  }

  return doc.content
    .map((block) => {
      const text = extractText(block)
      const b = block as { type?: string }
      // Add newlines for block elements
      if (b.type === "paragraph" || b.type === "heading") {
        return text + "\n"
      }
      if (b.type === "bulletList" || b.type === "orderedList") {
        return text + "\n"
      }
      return text
    })
    .join("\n")
    .trim()
}

/**
 * Format comments for the prompt
 */
const formatComments = (comments: readonly JiraComment[]): string => {
  if (comments.length === 0) return "No comments."

  return comments
    .map((comment, i) => {
      const author =
        comment.author?.displayName ?? comment.author?.emailAddress ?? "Unknown"
      const body =
        typeof comment.body === "string"
          ? comment.body
          : adfToText(comment.body)
      const date = comment.created
        ? new Date(comment.created).toLocaleDateString()
        : "Unknown date"
      return `[${i + 1}] ${author} (${date}):\n${body}`
    })
    .join("\n\n")
}

/**
 * Build the prompt for OpenCode
 */
const buildPrompt = (params: {
  taskId: number
  jiraKey: string
  summary: string
  description: string
  comments: string
  branchName: string
  baseBranch: string
}): string => `You are working on a Jira task. Here are the details:

**Task ID**: ${params.taskId}
**Jira Key**: ${params.jiraKey}
**Summary**: ${params.summary}

**Description**:
${params.description || "No description provided."}

**Comments**:
${params.comments}

---

**Instructions**:
1. You are already on a new branch named: \`${params.branchName}\`
2. Implement the task described above
3. Commit your changes with a meaningful commit message that references the Jira key (e.g., "${params.jiraKey}: <description>")
4. Push the branch to origin

When you're done, make sure all changes are committed and pushed.
`

/**
 * Create the task workflow layer
 */
export const TaskWorkflowLayer = TaskWorkflow.toLayer(
  (payload, executionId) =>
    Effect.gen(function* () {
      const db = yield* Database
      const jiraClient = yield* JiraClient
      const gitService = yield* GitService
      const openCodeClient = yield* OpenCodeClientService
      const config = yield* AtlassianConfigService

      yield* Console.log(
        `[Workflow ${executionId}] Starting task ${payload.taskId} (${payload.jiraKey})`
      )

      // Activity 1: Update status to IN_PROGRESS
      yield* Activity.make({
        name: "UpdateStatusToInProgress",
        execute: Effect.gen(function* () {
          yield* db.updateStatus(payload.taskId, "IN_PROGRESS")
          yield* Console.log(
            `[Workflow ${executionId}] Task ${payload.taskId} is now IN_PROGRESS`
          )
        }),
      })

      // Parse Jira issue data
      const jiraIssue = JSON.parse(payload.jiraData) as JiraIssue

      // Use deterministic temp directory based on task ID (not random UUID!)
      // This ensures replayed workflows use the same directory
      const tempDir = join(tmpdir(), `opencode-task-${payload.taskId}`)
      const branchName = `feature/${payload.jiraKey}-${payload.taskId}`

      yield* Activity.make({
        name: "CloneRepository",
        success: Schema.Struct({ tempDir: Schema.String, branchName: Schema.String }),
        error: TaskWorkflowError,
        execute: Effect.gen(function* () {
          // Clean up any existing directory first (in case of retry)
          yield* Effect.sync(() => {
            Bun.spawnSync(["rm", "-rf", tempDir])
          })
          
          yield* Console.log(
            `[Workflow ${executionId}] Cloning ${config.repositoryUrl} to ${tempDir}`
          )
          
          // Actually run git clone
          yield* gitService.clone(config.repositoryUrl, tempDir).pipe(
            Effect.mapError(
              (e) =>
                new TaskWorkflowError({
                  message: `Git clone failed: ${e.message}`,
                  phase: "clone",
                  cause: e,
                })
            )
          )
          
          yield* Console.log(
            `[Workflow ${executionId}] Clone completed, verifying directory exists...`
          )
          
          // Verify the directory was created
          const dirExists = yield* Effect.sync(() => {
            const stat = Bun.spawnSync(["test", "-d", tempDir])
            return stat.exitCode === 0
          })
          
          if (!dirExists) {
            return yield* Effect.fail(
              new TaskWorkflowError({
                message: `Clone appeared to succeed but directory ${tempDir} does not exist`,
                phase: "clone-verify",
              })
            )
          }
          
          yield* Console.log(
            `[Workflow ${executionId}] Directory verified. Creating branch ${branchName}`
          )
          
          yield* gitService.checkoutNewBranch(tempDir, branchName).pipe(
            Effect.mapError(
              (e) =>
                new TaskWorkflowError({
                  message: `Git checkout failed: ${e.message}`,
                  phase: "checkout",
                  cause: e,
                })
            )
          )
          
          yield* Console.log(
            `[Workflow ${executionId}] Branch ${branchName} created successfully`
          )
          
          return { tempDir, branchName }
        }),
      }).pipe(
        TaskWorkflow.withCompensation((_, cause) =>
          Effect.gen(function* () {
            yield* Console.log(
              `[Workflow ${executionId}] Compensation: Cleaning up ${tempDir}`
            )
            // Clean up temp directory on failure
            yield* Effect.try(() => {
              Bun.spawnSync(["rm", "-rf", tempDir])
            }).pipe(Effect.ignore)
          })
        )
      )

      // Activity 3: Fetch Jira comments
      const comments = yield* Activity.make({
        name: "FetchJiraComments",
        success: Schema.Array(Schema.Unknown),
        error: TaskWorkflowError,
        execute: Effect.gen(function* () {
          yield* Console.log(
            `[Workflow ${executionId}] Fetching comments for ${payload.jiraKey}`
          )
          const fetchedComments = yield* jiraClient
            .getIssueComments(payload.jiraKey)
            .pipe(
              Effect.mapError(
                (e) =>
                  new TaskWorkflowError({
                    message: e.message,
                    phase: "fetch-comments",
                    cause: e,
                  })
              )
            )
          return fetchedComments as unknown[]
        }),
      })

      // Build the prompt
      const summary = jiraIssue.fields.summary
      const description =
        typeof jiraIssue.fields.description === "string"
          ? jiraIssue.fields.description
          : adfToText(jiraIssue.fields.description)
      const formattedComments = formatComments(comments as JiraComment[])

      const prompt = buildPrompt({
        taskId: payload.taskId,
        jiraKey: payload.jiraKey,
        summary,
        description,
        comments: formattedComments,
        branchName,
        baseBranch: config.baseBranch,
      })

      // Activity 4: Run OpenCode
      const openCodeResult = yield* Activity.make({
        name: "RunOpenCode",
        success: Schema.Struct({
          sessionId: Schema.String,
          completed: Schema.Boolean,
        }),
        error: TaskWorkflowError,
        execute: Effect.gen(function* () {
          yield* Console.log(
            `[Workflow ${executionId}] Running OpenCode in ${tempDir}`
          )
          const result = yield* openCodeClient
            .runTask({
              workDir: tempDir,
              prompt,
            })
            .pipe(
              Effect.mapError(
                (e) =>
                  new TaskWorkflowError({
                    message: e.message,
                    phase: "opencode",
                    cause: e,
                  })
              )
            )
          return result
        }),
      })

       // Activity 5: Update status to DONE and cleanup
       yield* Activity.make({
         name: "UpdateStatusToDone",
         execute: Effect.gen(function* () {
           // First, try to transition the Jira issue to "Code Review"
           // If it fails, log a warning but continue with DONE update
           yield* Console.log(
             `[Workflow ${executionId}] Transitioning Jira issue ${payload.jiraKey} to Code Review`
           )
           yield* jiraClient
             .transitionIssue(payload.jiraKey, "Code Review")
             .pipe(
               Effect.tapError(
                 (e) =>
                   Console.error(
                     `[Workflow ${executionId}] Warning: Failed to transition Jira issue: ${e.message}`
                   )
               ),
               Effect.ignore
             )
           
           yield* Console.log(
             `[Workflow ${executionId}] Jira transition completed (or skipped)`
           )

           // Construct the Bitbucket PR URL and add it as a comment
           yield* Console.log(
             `[Workflow ${executionId}] Creating PR URL comment for ${payload.jiraKey}`
           )
           
           yield* Effect.gen(function* () {
             const prUrl = yield* gitService
               .getBitbucketPrUrl(config.repositoryUrl, branchName, config.baseBranch)
             
             yield* jiraClient
               .addComment(payload.jiraKey, `Pull Request: ${prUrl}`)
             
             yield* Console.log(
               `[Workflow ${executionId}] PR URL comment added to ${payload.jiraKey}`
             )
           }).pipe(
             Effect.tapError(
               (e) =>
                 Console.error(
                   `[Workflow ${executionId}] Warning: Failed to add PR URL comment: ${e.message}`
                 )
             ),
             Effect.ignore
           )

           // Then update database status to DONE
           yield* db.updateStatus(payload.taskId, "DONE")
           yield* Console.log(
             `[Workflow ${executionId}] Task ${payload.taskId} completed (DONE)`
           )

           // Clean up temp directory
           yield* Effect.try(() => {
             Bun.spawnSync(["rm", "-rf", tempDir])
           }).pipe(Effect.ignore)
         }),
       })

      return {
        sessionId: openCodeResult.sessionId,
        branchName,
      }
    }).pipe(
      // On any failure, mark the task as FAILED
      Effect.tapErrorCause((cause) =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.updateStatus(payload.taskId, "FAILED")
          yield* Console.error(
            `[Workflow] Task ${payload.taskId} FAILED: ${cause}`
          )
        }).pipe(Effect.ignore)
      )
    )
)

/**
 * Combined layer for the workflow engine and task workflow
 */
export const TaskWorkflowEngineLive = TaskWorkflowLayer.pipe(
  Layer.provide(WorkflowEngine.layerMemory)
)
