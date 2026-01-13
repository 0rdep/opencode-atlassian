#!/usr/bin/env bun

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Console from "effect/Console"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import * as FetchHttpClient from "@effect/platform/FetchHttpClient"
import * as Command from "@effect/cli/Command"
import { WorkflowEngine } from "@effect/workflow"
import {
  startOptions,
  makeConfigLayer,
  type StartCommandOptions,
} from "./config/Config.ts"
import { DatabaseLive } from "./services/Database.ts"
import { JiraClientLive } from "./services/JiraClient.ts"
import { GitServiceLive } from "./services/GitService.ts"
import { OpenCodeClientLive } from "./services/OpenCodeClient.ts"
import { TaskWorkflowLayer } from "./workflows/TaskWorkflow.ts"
import { startHandler } from "./commands/start.ts"
import { listHandler, listOptions } from "./commands/list.ts"

/**
 * Create the full application layer from CLI options
 */
const makeAppLayer = (options: StartCommandOptions) => {
  const configLayer = makeConfigLayer(options)
  const dbLayer = DatabaseLive()
  const gitLayer = GitServiceLive
  const openCodeLayer = OpenCodeClientLive

  // JiraClientLive needs config + http client
  const jiraLayer = JiraClientLive.pipe(
    Layer.provide(configLayer),
    Layer.provide(FetchHttpClient.layer)
  )

  // Base services layer (everything except workflow)
  const servicesLayer = Layer.mergeAll(
    configLayer,
    dbLayer,
    gitLayer,
    openCodeLayer,
    jiraLayer
  )

  // Workflow layer needs all services + WorkflowEngine
  const workflowLayer = TaskWorkflowLayer.pipe(
    Layer.provide(WorkflowEngine.layerMemory),
    Layer.provide(servicesLayer)
  )

  // Merge services + workflow engine + workflow layer
  return Layer.mergeAll(servicesLayer, WorkflowEngine.layerMemory, workflowLayer)
}

/**
 * Start command - polls Jira and processes tasks
 */
const startCommand = Command.make(
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
      Effect.provide(makeAppLayer(args)),
      Effect.catchAllCause((cause) => Console.error(`Fatal error: ${cause}`))
    )
)

/**
 * List command - displays all tasks in a table
 */
const listCommand = Command.make(
  "list",
  {
    status: listOptions.status,
    limit: listOptions.limit,
  },
  (args) =>
    listHandler(args).pipe(
      Effect.provide(DatabaseLive()),
      Effect.catchAllCause((cause) => Console.error(`Error: ${cause}`))
    )
)

/**
 * Root command with subcommands
 */
const rootCommand = Command.make("opencode-atlassian").pipe(
  Command.withSubcommands([startCommand, listCommand])
)

/**
 * Run the CLI
 */
const run = Command.run(rootCommand, {
  name: "opencode-atlassian",
  version: "0.1.0",
})

run(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
