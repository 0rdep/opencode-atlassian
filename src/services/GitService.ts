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
   * Get the remote URL for the origin
   */
  readonly getRemoteUrl: (workDir: string) => Effect.Effect<string, GitError, CommandExecutor>

  /**
   * Construct a Bitbucket PR creation URL from a remote URL and branch name
   */
  readonly getBitbucketPrUrl: (
    remoteUrl: string,
    branchName: string,
    baseBranch: string
  ) => Effect.Effect<string, GitError>
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

  getRemoteUrl: (workDir: string) =>
    Effect.gen(function* () {
      // Input validation
      if (!workDir || workDir.trim() === "") {
        return yield* Effect.fail(
          new GitError({
            message: "Working directory cannot be empty",
            command: "git remote get-url origin",
          })
        )
      }

      return yield* runGitCommand(["remote", "get-url", "origin"], workDir)
    }).pipe(
      Effect.mapError(
        (error) =>
          new GitError({
            message: `Failed to get remote URL: ${error.message}`,
            command: error.command,
            cause: error,
          })
      )
    ),

  getBitbucketPrUrl: (remoteUrl: string, branchName: string, baseBranch: string) =>
    Effect.gen(function* () {
      // Parse the remote URL to extract workspace and repo
      // Supports formats:
      // - git@bitbucket.org:workspace/repo.git
      // - https://bitbucket.org/workspace/repo.git
      // - https://user@bitbucket.org/workspace/repo.git
      
      let workspace: string = ""
      let repo: string = ""
      
      // Remove trailing .git if present
      const cleanUrl = remoteUrl.replace(/\.git$/, "")
      
      if (cleanUrl.startsWith("git@bitbucket.org:")) {
        // SSH format: git@bitbucket.org:workspace/repo
        const path = cleanUrl.replace("git@bitbucket.org:", "")
        const parts = path.split("/")
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          return yield* Effect.fail(
            new GitError({
              message: `Invalid Bitbucket SSH URL format: ${remoteUrl}`,
            })
          )
        }
        workspace = parts[0]
        repo = parts[1]
      } else if (cleanUrl.includes("bitbucket.org/")) {
        // HTTPS format: https://bitbucket.org/workspace/repo or https://user@bitbucket.org/workspace/repo
        const match = cleanUrl.match(/bitbucket\.org\/([^/]+)\/([^/]+)/)
        if (!match || !match[1] || !match[2]) {
          return yield* Effect.fail(
            new GitError({
              message: `Invalid Bitbucket HTTPS URL format: ${remoteUrl}`,
            })
          )
        }
        workspace = match[1]
        repo = match[2]
      } else {
        return yield* Effect.fail(
          new GitError({
            message: `Unsupported repository URL format: ${remoteUrl}. Expected Bitbucket URL.`,
          })
        )
      }
      
      // Construct the Bitbucket PR creation URL
      // Format: https://bitbucket.org/{workspace}/{repo}/pull-requests/new?source={branch}&dest={baseBranch}
      const prUrl = `https://bitbucket.org/${workspace}/${repo}/pull-requests/new?source=${encodeURIComponent(branchName)}&dest=${encodeURIComponent(baseBranch)}`
      
      return prUrl
    }),
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
