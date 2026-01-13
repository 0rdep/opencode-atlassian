import { Database as BunDatabase } from "bun:sqlite"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Task, TaskInsert, TaskStatus } from "../schema/Task.ts"

/**
 * Database service interface
 */
export interface DatabaseService {
  /**
   * Initialize the database schema
   */
  readonly init: Effect.Effect<void>

  /**
   * Find an active task by Jira ID
   * Active means status is WAITING_TO_WORK or IN_PROGRESS
   */
  readonly findActiveByJiraId: (
    jiraId: string
  ) => Effect.Effect<Option.Option<Task>>

  /**
   * Insert a new task
   */
  readonly insert: (task: TaskInsert) => Effect.Effect<Task>

  /**
   * Update task status
   */
  readonly updateStatus: (
    id: number,
    status: TaskStatus
  ) => Effect.Effect<void>

  /**
   * Get all tasks with a specific status
   */
  readonly findByStatus: (status: TaskStatus) => Effect.Effect<readonly Task[]>

  /**
   * Get task by ID
   */
  readonly findById: (id: number) => Effect.Effect<Option.Option<Task>>

  /**
   * Get all tasks
   */
  readonly findAll: () => Effect.Effect<readonly Task[]>
}

/**
 * Database service tag
 */
export class Database extends Context.Tag("Database")<
  Database,
  DatabaseService
>() {}

/**
 * SQL statements
 */
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jira_id TEXT NOT NULL,
    jira_key TEXT NOT NULL,
    jira_status TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING_TO_WORK',
    data TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`

const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_tasks_jira_id_status ON tasks(jira_id, status)
`

const INSERT_TASK_SQL = `
  INSERT INTO tasks (jira_id, jira_key, jira_status, status, data)
  VALUES (?, ?, ?, ?, ?)
  RETURNING *
`

const FIND_ACTIVE_BY_JIRA_ID_SQL = `
  SELECT * FROM tasks
  WHERE jira_id = ? AND status IN ('WAITING_TO_WORK', 'IN_PROGRESS')
  ORDER BY created_at DESC
  LIMIT 1
`

const UPDATE_STATUS_SQL = `
  UPDATE tasks
  SET status = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`

const FIND_BY_STATUS_SQL = `
  SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC
`

const FIND_BY_ID_SQL = `
  SELECT * FROM tasks WHERE id = ?
`

const FIND_ALL_SQL = `
  SELECT * FROM tasks ORDER BY created_at DESC
`

/**
 * Row type from SQLite
 */
interface TaskRow {
  id: number
  jira_id: string
  jira_key: string
  jira_status: string
  status: string
  data: string
  created_at: string
  updated_at: string
}

/**
 * Convert database row to Task entity
 */
const rowToTask = (row: TaskRow): Task =>
  new Task({
    id: row.id,
    jiraId: row.jira_id,
    jiraKey: row.jira_key,
    jiraStatus: row.jira_status,
    status: row.status as TaskStatus,
    data: row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

/**
 * Create the Database service implementation
 */
const makeDatabaseService = (db: BunDatabase): DatabaseService => ({
  init: Effect.sync(() => {
    db.run(CREATE_TABLE_SQL)
    db.run(CREATE_INDEX_SQL)
  }),

  findActiveByJiraId: (jiraId: string) =>
    Effect.sync(() => {
      const row = db.query<TaskRow, [string]>(FIND_ACTIVE_BY_JIRA_ID_SQL).get(jiraId)
      return row ? Option.some(rowToTask(row)) : Option.none()
    }),

  insert: (task: TaskInsert) =>
    Effect.sync(() => {
      const row = db
        .query<TaskRow, [string, string, string, string, string]>(INSERT_TASK_SQL)
        .get(task.jiraId, task.jiraKey, task.jiraStatus, task.status, task.data)
      if (!row) {
        throw new Error("Failed to insert task")
      }
      return rowToTask(row)
    }),

  updateStatus: (id: number, status: TaskStatus) =>
    Effect.sync(() => {
      db.run(UPDATE_STATUS_SQL, [status, id])
    }),

  findByStatus: (status: TaskStatus) =>
    Effect.sync(() => {
      const rows = db.query<TaskRow, [string]>(FIND_BY_STATUS_SQL).all(status)
      return rows.map(rowToTask)
    }),

  findById: (id: number) =>
    Effect.sync(() => {
      const row = db.query<TaskRow, [number]>(FIND_BY_ID_SQL).get(id)
      return row ? Option.some(rowToTask(row)) : Option.none()
    }),

  findAll: () =>
    Effect.sync(() => {
      const rows = db.query<TaskRow, []>(FIND_ALL_SQL).all()
      return rows.map(rowToTask)
    }),
})

/**
 * Default database path
 */
const DEFAULT_DB_PATH = "./data/tasks.db"

/**
 * Create a Layer that provides the Database service
 */
export const DatabaseLive = (
  dbPath: string = DEFAULT_DB_PATH
): Layer.Layer<Database> =>
  Layer.effect(
    Database,
    Effect.sync(() => {
      // Ensure data directory exists
      const dir = dbPath.substring(0, dbPath.lastIndexOf("/"))
      if (dir) {
        Bun.spawnSync(["mkdir", "-p", dir])
      }
      const db = new BunDatabase(dbPath, { create: true, strict: true })
      const service = makeDatabaseService(db)
      // Initialize the database schema synchronously
      db.run(CREATE_TABLE_SQL)
      db.run(CREATE_INDEX_SQL)
      return service
    })
  )
