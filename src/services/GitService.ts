import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Command } from "@effect/platform"
import type { CommandExecutor } from "@effect/platform/CommandExecutor"

/**
 * Git operation errors
 */
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  message: Schema.String,
  command: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Git service interface
 */
export interface GitServiceI {
  /**
   * Clone a repository to a target directory
   */
  readonly clone: (
    repoUrl: string,
    targetDir: string
  ) => Effect.Effect<void, GitError, CommandExecutor>

  /**
   * Checkout a new branch from the current HEAD
   */
  readonly checkoutNewBranch: (
    workDir: string,
    branchName: string
  ) => Effect.Effect<void, GitError, CommandExecutor>

  /**
   * Get the current branch name
   */
  readonly getCurrentBranch: (workDir: string) => Effect.Effect<string, GitError, CommandExecutor>

  /**
   * Get the pull request URL for the current branch
   */
  readonly getPullRequestUrl: (workDir: string) => Effect.Effect<string, GitError, CommandExecutor>
}

/**
 * Git service tag
 */
export class GitService extends Context.Tag("GitService")<
  GitService,
  GitServiceI
>() {}

/**
 * Execute a git command using Effect Platform Command and handle errors
 */
const runGitCommand = (
  args: readonly string[],
  workDir?: string
): Effect.Effect<string, GitError, CommandExecutor> =>
  Effect.gen(function* () {
    const cmd = `git ${args.join(" ")}`
    yield* Effect.log(`[Git] Running: ${cmd}${workDir ? ` in ${workDir}` : ""}`)

    // Build the command with optional working directory
    let command = Command.make("git", ...args)
    if (workDir) {
      command = command.pipe(Command.workingDirectory(workDir))
    }

    // Execute the command and get output
    const output = yield* Command.string(command).pipe(
      Effect.catchAll((error) =>
        Effect.fail(
          new GitError({
            message: `Failed to execute git command: ${error instanceof Error ? error.message : String(error)}`,
            command: cmd,
            cause: error,
          })
        )
      )
    )

    const stdout = output.trim()
    yield* Effect.log(
      `[Git] Success: ${stdout.slice(0, 100)}${stdout.length > 100 ? "..." : ""}`
    )
    return stdout
  })

/**
 * Create the Git service implementation
 */
const makeGitService = (): GitServiceI => ({
  clone: (repoUrl: string, targetDir: string) =>
    Effect.gen(function* () {
      // Input validation
      if (!repoUrl || repoUrl.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Repository URL cannot be empty",
            command: "git clone",
          })
        )
      }
      if (!targetDir || targetDir.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Target directory cannot be empty",
            command: "git clone",
          })
        )
      }

      const result = yield* runGitCommand(["clone", repoUrl, targetDir])
      return undefined
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to clone repository: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  checkoutNewBranch: (workDir: string, branchName: string) =>
    Effect.gen(function* () {
      // Input validation
      if (!workDir || workDir.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Working directory cannot be empty",
            command: "git checkout -b",
          })
        )
      }
      if (!branchName || branchName.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Branch name cannot be empty",
            command: "git checkout -b",
          })
        )
      }

      const result = yield* runGitCommand(["checkout", "-b", branchName], workDir)
      return undefined
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to create branch ${branchName}: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  getCurrentBranch: (workDir: string) =>
    Effect.gen(function* () {
      // Input validation
      if (!workDir || workDir.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Working directory cannot be empty",
            command: "git rev-parse --abbrev-ref HEAD",
          })
        )
      }

      return yield* runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], workDir)
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to get current branch: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  getPullRequestUrl: (workDir: string) =>
    Effect.gen(function* () {
      // Input validation
      if (!workDir || workDir.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Working directory cannot be empty",
            command: "gh pr view --json url",
          })
        )
      }

      yield* Effect.log(`[Git] Getting PR URL in ${workDir}`)

      // Use gh CLI to get the PR URL for the current branch
      let command = Command.make("gh", "pr", "view", "--json", "url", "--jq", ".url")
      command = command.pipe(Command.workingDirectory(workDir))

      const output = yield* Command.string(command).pipe(
        Effect.catchAll((error) =>
          Effect.fail(
            new GitError({
              message: `Failed to get PR URL: ${error instanceof Error ? error.message : String(error)}`,
              command: "gh pr view --json url",
              cause: error,
            })
          )
        )
      )

      const prUrl = output.trim()
      if (!prUrl) {
        return yield* Effect.fail(
          new GitError({
            message: "No pull request found for current branch",
            command: "gh pr view --json url",
          })
        )
      }

      yield* Effect.log(`[Git] Found PR URL: ${prUrl}`)
      return prUrl
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to get pull request URL: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),
})

/**
 * Layer that provides the GitService
 */
export const GitServiceLive: Layer.Layer<GitService, never, CommandExecutor> = Layer.effect(
  GitService,
  Effect.gen(function* () {
    // CommandExecutor is provided by the platform layer (BunContext.layer)
    // We don't directly use it here, but the service methods need it at runtime
    return makeGitService()
  })
)
