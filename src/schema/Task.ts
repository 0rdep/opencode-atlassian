import * as Schema from "effect/Schema"

/**
 * Task status on the CLI side
 * - WAITING_TO_WORK: Task has been picked up from Jira, waiting to be processed
 * - IN_PROGRESS: Task is currently being processed by a runner
 * - DONE: Task has been completed
 */
export const TaskStatus = Schema.Literal(
  "WAITING_TO_WORK",
  "IN_PROGRESS",
  "DONE",
  "FAILED"
)
export type TaskStatus = typeof TaskStatus.Type

/**
 * Task entity stored in SQLite database
 */
export class Task extends Schema.Class<Task>("Task")({
  id: Schema.Number,
  jiraId: Schema.String,
  jiraKey: Schema.String,
  jiraStatus: Schema.String,
  status: TaskStatus,
  data: Schema.String, // JSON string of full Jira issue
  createdAt: Schema.String,
  updatedAt: Schema.String,
}) {}

/**
 * Schema for inserting a new task (without id and timestamps)
 */
export class TaskInsert extends Schema.Class<TaskInsert>("TaskInsert")({
  jiraId: Schema.String,
  jiraKey: Schema.String,
  jiraStatus: Schema.String,
  status: TaskStatus,
  data: Schema.String,
}) {}

/**
 * Active task statuses - tasks with these statuses are considered "in flight"
 * and should not be picked up again from Jira
 */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "WAITING_TO_WORK",
  "IN_PROGRESS",
] as const
