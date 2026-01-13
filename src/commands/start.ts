import * as Effect from "effect/Effect"
import * as Schedule from "effect/Schedule"
import * as Duration from "effect/Duration"
import * as Console from "effect/Console"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Layer from "effect/Layer"
import * as Command from "@effect/cli/Command"
import { WorkflowEngine } from "@effect/workflow"
import type { WorkflowEngine as WorkflowEngineType } from "@effect/workflow/WorkflowEngine"
import {
  startOptions,
  AtlassianConfigService,
  type StartCommandOptions,
} from "../config/Config.ts"
import { Database } from "../services/Database.ts"
import { JiraClient, JiraClientError } from "../services/JiraClient.ts"
import { GitService } from "../services/GitService.ts"
import { OpenCodeClientService } from "../services/OpenCodeClient.ts"
import { TaskInsert, type Task } from "../schema/Task.ts"
import type { JiraIssue } from "../schema/JiraIssue.ts"
import { TaskWorkflow, TaskWorkflowLayer } from "../workflows/TaskWorkflow.ts"

/**
 * Process a single Jira issue:
 * - Check if there's already an active task for this issue
 * - If not, create a new task and return it for running
 */
const processJiraIssue = (
  issue: JiraIssue
): Effect.Effect<Option.Option<Task>, never, Database> =>
  Effect.gen(function* () {
    const db = yield* Database

    // Check if we already have an active task for this Jira issue
    const existingTask = yield* db.findActiveByJiraId(issue.id)

    if (Option.isSome(existingTask)) {
      yield* Console.log(
        `[Sync] Skipping ${issue.key} - already has active task (${existingTask.value.status})`
      )
      return Option.none()
    }

    // Create new task
    const taskInsert = new TaskInsert({
      jiraId: issue.id,
      jiraKey: issue.key,
      jiraStatus: issue.fields.status.name,
      status: "WAITING_TO_WORK",
      data: JSON.stringify(issue),
    })

    const task = yield* db.insert(taskInsert)
    yield* Console.log(
      `[Sync] Created new task ${task.id} for ${issue.key} (${issue.fields.status.name})`
    )

    return Option.some(task)
  })

/**
 * Run a single polling cycle:
 * 1. Fetch issues from Jira
 * 2. Process each issue (create tasks if needed)
 * 3. Queue tasks for workflow execution
 */
const pollCycle = (
  runnerQueue: Queue.Queue<Task>
): Effect.Effect<void, JiraClientError, Database | JiraClient> =>
  Effect.gen(function* () {
    const jiraClient = yield* JiraClient

    yield* Console.log("[Poll] Fetching issues from Jira...")

    const issues = yield* jiraClient.searchAssignedIssues()

    yield* Console.log(`[Poll] Found ${issues.length} issues matching filter`)

    // Process each issue and collect new tasks
    for (const issue of issues) {
      const maybeTask = yield* processJiraIssue(issue)
      if (Option.isSome(maybeTask)) {
        // Queue the task for running
        yield* Queue.offer(runnerQueue, maybeTask.value)
      }
    }

    yield* Console.log("[Poll] Cycle complete")
  })

/**
 * Task workflow worker that processes tasks from the queue
 * Uses the Effect Workflow to execute tasks
 */
const workflowWorker = (
  queue: Queue.Queue<Task>
): Effect.Effect<
  never,
  never,
  Database | JiraClient | GitService | OpenCodeClientService | AtlassianConfigService | WorkflowEngineType
> =>
  Effect.gen(function* () {
    // Continuously take tasks from queue and run them through the workflow
    while (true) {
      const task = yield* Queue.take(queue)

      yield* Console.log(`[Worker] Starting workflow for task ${task.id} (${task.jiraKey})`)

      // Execute the workflow
      yield* TaskWorkflow.execute({
        taskId: task.id,
        jiraKey: task.jiraKey,
        jiraData: task.data,
      }).pipe(
        Effect.tap((result) =>
          Console.log(
            `[Worker] Task ${task.id} completed. Branch: ${result.branchName}, Session: ${result.sessionId}`
          )
        ),
        Effect.catchAllCause((cause) =>
          Console.error(`[Worker] Task ${task.id} failed: ${cause}`)
        )
      )
    }
  })

/**
 * Start command handler
 */
export const startHandler = (
  options: StartCommandOptions
): Effect.Effect<
  void,
  JiraClientError,
  | Database
  | JiraClient
  | GitService
  | OpenCodeClientService
  | AtlassianConfigService
  | WorkflowEngineType
> =>
  Effect.gen(function* () {
    const config = yield* AtlassianConfigService

    yield* Console.log("=== OpenCode Atlassian CLI ===")
    yield* Console.log(`Domain: ${config.domain}`)
    yield* Console.log(`Jira Status Filter: ${config.jiraStatus}`)
    yield* Console.log(`Poll Interval: ${config.interval}s`)
    yield* Console.log(`Concurrency: ${config.concurrency}`)
    yield* Console.log(`Repository: ${config.repositoryUrl}`)
    yield* Console.log(`Base Branch: ${config.baseBranch}`)
    yield* Console.log(`Using: assignee = currentUser()`)
    yield* Console.log("")

    // Create a bounded queue for tasks
    const taskQueue = yield* Queue.bounded<Task>(100)

    // Start worker fibers based on concurrency setting
    yield* Effect.all(
      Array.from({ length: config.concurrency }, (_, i) =>
        workflowWorker(taskQueue).pipe(
          Effect.fork,
          Effect.tap(() => Console.log(`[Main] Started worker ${i + 1}`))
        )
      )
    )

    yield* Console.log(`[Main] Started ${config.concurrency} workflow workers`)
    yield* Console.log("[Main] Starting polling loop...")
    yield* Console.log("")

    // Create schedule for polling
    const schedule = Schedule.spaced(Duration.seconds(config.interval))

    // Run polling loop with schedule
    yield* pollCycle(taskQueue).pipe(
      Effect.catchAll((error) =>
        Console.error(`[Poll] Error: ${error.message}`)
      ),
      Effect.repeat(schedule)
    )
  })

/**
 * Start command definition
 */
export const startCommand = Command.make(
  "start",
  {
    email: startOptions.email,
    token: startOptions.token,
    domain: startOptions.domain,
    jiraStatus: startOptions.jiraStatus,
    interval: startOptions.interval,
    concurrency: startOptions.concurrency,
    repositoryUrl: startOptions.repositoryUrl,
    baseBranch: startOptions.baseBranch,
  },
  (args) =>
    startHandler(args).pipe(
      Effect.catchAll((error) => Console.error(`Fatal error: ${error}`))
    )
)
