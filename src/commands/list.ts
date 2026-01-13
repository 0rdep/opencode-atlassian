import * as Effect from "effect/Effect"
import * as Console from "effect/Console"
import { Database } from "../services/Database.ts"
import type { Task } from "../schema/Task.ts"

/**
 * Format tasks as an ASCII table
 */
const formatTable = (tasks: readonly Task[]): string => {
  if (tasks.length === 0) {
    return "No tasks found."
  }

  // Define columns with their headers and widths
  const columns = [
    { header: "ID", width: 6 },
    { header: "Jira Key", width: 12 },
    { header: "Status", width: 18 },
    { header: "Jira Status", width: 15 },
    { header: "Created At", width: 20 },
  ] as const

  // Table header
  const header = columns.map((col) => col.header.padEnd(col.width)).join(" | ")

  const separator = columns.map((col) => "-".repeat(col.width)).join("-+-")

  // Table rows
  const rows = tasks.map((task) =>
    [
      String(task.id).padEnd(6),
      task.jiraKey.padEnd(12),
      task.status.padEnd(18),
      task.jiraStatus.padEnd(15),
      task.createdAt.substring(0, 19).padEnd(20),
    ].join(" | ")
  )

  return [header, separator, ...rows].join("\n")
}

/**
 * List tasks command handler
 */
export const listHandler = Effect.gen(function* () {
  const db = yield* Database

  yield* Console.log("=== Tasks ===\n")

  const tasks = yield* db.findAll()
  const table = formatTable(tasks)

  yield* Console.log(table)
  yield* Console.log(`\nTotal: ${tasks.length} task(s)`)
})
