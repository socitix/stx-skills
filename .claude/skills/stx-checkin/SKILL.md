---
name: stx-checkin
description: Secure git workflow with pre-commit security scanning, staging, commit, and branch-aware push/PR creation
version: 1.10.4
author: STX
---

# /stx-checkin

A comprehensive git check-in workflow that scans for sensitive files, stages changes, commits with co-authorship, and handles pushing or PR creation based on your current branch.

## Usage

```bash
/stx-checkin                     # Interactive mode
/stx-checkin -m "feat: add login" # With commit message
/stx-checkin --dry-run           # Preview only, no changes
/stx-checkin --skip-push         # Commit only, no push/PR
/stx-checkin --force             # Skip confirmations (careful!)
```

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--message` | `-m` | Provide commit message (skips prompt) |
| `--dry-run` | | Preview only, no changes made |
| `--skip-push` | | Commit only, don't push or create PR |
| `--force` | `-f` | Skip all confirmations (use carefully) |
| `--help` | `-h` | Show help message |

## Workflow Steps

### Step 1: Git Status Check
Shows all modified, added, and deleted files. Exits if no changes detected.

### Step 2: Security Scan
Detects and categorizes files:
- **BLOCKED**: Sensitive files (.env, *.pem, credentials.json) - cannot proceed
- **WARNED**: Unwanted files (.DS_Store, node_modules/) - can proceed with confirmation
- **FLAGGED**: Large files (>10MB) - suggests Git LFS

Shows `.gitignore` suggestions for any issues found.

### Step 3: Deleted Files Confirmation
Lists files being removed from the repository. Requires confirmation to proceed.

### Step 4: Staging
Runs `git add -A` to stage all changes.

### Step 5: Commit
Prompts for commit message (unless provided via `-m`). Automatically adds:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Step 6: Push / PR Creation (Branch-Aware)

**On main/master branch:**
- Confirms before pushing directly to origin

**On feature branch:**
- Pushes branch to remote
- Offers to create PR via GitHub CLI (`gh pr create`)

## Exit Points

At any confirmation prompt, type one of:
- `exit`
- `quit`
- `q`
- `n` (for No)

This cleanly aborts the workflow without making changes.

## Security Patterns

### Blocked Files (Cannot Proceed)
- `.env`, `.env.*` - Environment variables with secrets
- `*.pem`, `*.key` - Private keys
- `credentials.json` - Cloud credentials
- `secrets.json` - Application secrets
- `firebase-adminsdk*.json` - Firebase admin SDK
- `id_rsa`, `id_ed25519` - SSH private keys

### Warned Files (Confirm to Proceed)
- `.DS_Store`, `Thumbs.db` - OS metadata
- `node_modules/` - Dependencies
- `*.log` - Log files
- `.idea/`, `.vscode/` - IDE settings

## Examples

### Basic Usage
```bash
/stx-checkin
# Shows status, scans for issues, prompts for commit message
# Pushes to remote or creates PR based on branch
```

### Quick Commit with Message
```bash
/stx-checkin -m "fix: resolve login timeout issue"
# Skips commit message prompt, uses provided message
```

### Preview Mode
```bash
/stx-checkin --dry-run
# Shows what would happen without making any changes
# Great for reviewing before committing
```

### Commit Only (No Push)
```bash
/stx-checkin --skip-push
# Creates commit but doesn't push or create PR
# Useful when you want to make multiple commits before pushing
```

## Requirements

- Git installed and initialized in current directory
- Node.js 18+
- GitHub CLI (`gh`) for PR creation (optional)

## See Also

- [README.md](./README.md) - Research findings and design decisions
