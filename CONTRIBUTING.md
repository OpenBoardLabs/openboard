# Contributing to Openboard

Thank you for your interest in contributing to Openboard!

## Development Setup

1. **Prerequisites**
   - Node.js (LTS version)
   - Git
   - GitHub CLI (`gh`)

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development servers**
   ```bash
   npm run dev
   ```

   This starts both the client (Vite dev server) and server (Express with TypeScript).

## Project Structure

```
packages/
├── client/          # React frontend (Vite + TypeScript)
│   └── src/
├── server/          # Node.js backend (Express + TypeScript)
│   └── src/
```

## Running Tests

Check `package.json` for available test commands:
```bash
npm test
```

## Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Run lint/typecheck before submitting:
  ```bash
  npm run lint
  npm run typecheck
  ```

## Submitting Changes

1. Create a feature branch
2. Make your changes
3. Run tests and type checking
4. Submit a Pull Request

## License

By contributing to Openboard, you agree that your contributions will be licensed under the project's LICENSE.
