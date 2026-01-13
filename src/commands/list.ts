import * as Effect from "effect/Effect"
import * as Console from "effect/Console"
import * as Option from "effect/Option"
import * as Command from "@effect/cli/Command"
import * as Options from "@effect/cli/Options"
import { Database } from "../services/Database.ts"
import type { Task, TaskStatus } from "../schema/Task.ts"

/**
 * Command options for list command
 */
const statusOption = Options.optional(
  Options.text("status").pipe(
    Options.withAlias("s"),
    Options.withDescription(
      "Filter by task status (WAITING_TO_WORK, IN_PROGRESS, DONE, FAILED)"
    )
  )
)

const limitOption = Options.integer("limit").pipe(
  Options.withAlias("l"),
  Options.withDescription("Maximum number of tasks to display"),
  Options.withDefault(50)
)

export const listOptions = {
  status: statusOption,
  limit: limitOption,
}

export interface ListCommandOptions {
  readonly status: Option.Option<string>
  readonly limit: number
}

/**
 * Format a task row for table display
 */
const formatTaskRow = (task: Task): string => {
  const id = String(task.id).padStart(4, " ")
  const jiraKey = task.jiraKey.padEnd(12, " ")
  const status = task.status.padEnd(16, " ")
  const jiraStatus = task.jiraStatus.padEnd(15, " ")
  const updatedAt = task.updatedAt.slice(0, 19) // Trim to YYYY-MM-DD HH:MM:SS
  return `${id} | ${jiraKey} | ${status} | ${jiraStatus} | ${updatedAt}`
}

/**
 * Print table header
 */
const printTableHeader = (): Effect.Effect<void> =>
  Effect.gen(function* () {
    const header = "  ID | Jira Key     | Status           | Jira Status     | Updated At"
    const separator = "".padEnd(header.length, "-")
    yield* Console.log(header)
    yield* Console.log(separator)
  })

/**
 * List command handler
 */
export const listHandler = (
  options: ListCommandOptions
): Effect.Effect<void, never, Database> =>
  Effect.gen(function* () {
    const db = yield* Database

    yield* Console.log("=== Tasks ===\n")

    // Fetch tasks based on filter
    let tasks: readonly Task[]
    if (Option.isSome(options.status)) {
      const statusValue = options.status.value as TaskStatus
      tasks = yield* db.findByStatus(statusValue)
    } else {
      // Fetch all tasks using findAll
      tasks = yield* db.findAll(options.limit)
    }

    // Apply limit if filtering by status
    const displayTasks = Option.isSome(options.status)
      ? tasks.slice(0, options.limit)
      : tasks

    if (displayTasks.length === 0) {
      yield* Console.log("No tasks found.")
      return
    }

    // Print table
    yield* printTableHeader()
    for (const task of displayTasks) {
      yield* Console.log(formatTaskRow(task))
    }

    yield* Console.log("")
    if (tasks.length > displayTasks.length) {
      yield* Console.log(
        `Showing ${displayTasks.length} of ${tasks.length} tasks (use --limit to show more)`
      )
    } else {
      yield* Console.log(`Total: ${displayTasks.length} task(s)`)
    }
  })

/**
 * List command definition
 */
export const listCommand = Command.make(
  "list",
  {
    status: listOptions.status,
    limit: listOptions.limit,
  },
  (args) => listHandler(args)
)
