# Tester Agent Plan

## Objective
To autonomously setup, run, and test the OpenBoard application using browser automation to verify functionality, specifically tailoring tests to the completed task.

## Worktree Context
*   **Location**: `/Users/mokh/openboard/.openboard-worktrees/ticket-0b07e3af-e4c1-4d42-85dd-56c1d16ad10a-1773523440256`
*   **Architecture**: Monorepo with `packages/client` (Vite/React) and `packages/server` (Express/Node).

## Execution Plan

### 1. Environment Preparation
*   **Context**: Change directory to the worktree root.
*   **Dependencies**: Run `npm install` to ensure all packages are available.
*   **Tooling**: Install browser automation library.
    *   **Selected Library**: `playwright` (Recommended for reliability and speed).
    *   *Action*: `npm install -D @playwright/test`

### 2. Application Startup
*   **Launch**: Execute `npm run dev` in the background.
*   **Health Check**:
    *   Wait for Client on `http://localhost:5173`.
    *   Wait for Server (check logs for port, typically matches proxy or 3000+).

### 3. Task-Specific Testing Strategy
*   **Analyze Task**: The agent must read the task description (e.g., from `ticket-*/instructions.md` or prompt) to understand the *specific* changes made (e.g., "added a dark mode toggle" vs "fixed column dragging").
*   **Dynamic Test Generation**:
    *   **If UI Change**: Generate a Playwright script to interact with the new UI element.
    *   **If Logic Change**: specific input/output verification via UI.
    *   **Fallback**: Run a general "Smoke Test" (Load app, create ticket, move ticket) if no specific task context is found.

### 4. Automated Browser Interaction (via Playwright)
*   **Script**:
    ```typescript
    import { test, expect } from '@playwright/test';

    test('verify task functionality', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await expect(page).toHaveTitle(/OpenBoard/);
      // ... Insert dynamic steps here ...
    });
    ```
*   **Visual Verification**: Take a screenshot of the relevant state (`await page.screenshot({ path: 'verification.png' })`).

### 5. Cleanup & Reporting
*   Stop `npm run dev` processes.
*   Report success/failure.
*   Provide `verification.png` for user review.
