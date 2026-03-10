# Openboard

![Openboard Screenshot](./screenshot.png)

Openboard is a real-time Kanban board application featuring a React frontend and an Express/Node.js backend, organized as a monorepo using npm workspaces.

## Features

- **Kanban Boards**: Create and manage multiple boards.
- **Columns & Tickets**: Organize your work with customizable columns and draggable tickets.
- **Real-time Updates**: Changes are instantly synced across clients using Server-Sent Events (SSE).
- **Dark Mode**: Built-in theme switcher for light and dark modes.
- **Local Database**: Uses SQL.js for a lightweight, file-based SQLite database.

## Managing Coding Agents

We use a Kanban board to manage coding agents for several key reasons:

- **Visibility and Tracking**: A board provides a clear, visual representation of what each agent is currently working on, what tasks are queued, and what has been completed.
- **Task Decomposition**: Complex software engineering tasks can be broken down into smaller, manageable tickets, allowing multiple agents to work in parallel on different components.
- **State Management**: The board acts as a centralized state machine for the agents' progress. If an agent encounters an error or needs human intervention, the ticket status reflects this immediately.
- **Prioritization**: We can easily reorder tickets in the backlog to direct the agents' focus to the most critical tasks first.
- **Collaboration**: It facilitates seamless handoffs between different specialized agents (e.g., an architecture agent breaking down a task into tickets, which are then picked up by implementation agents).

## Tech Stack

### Frontend (`packages/client`)
- **Framework:** React with Vite
- **Language:** TypeScript
- **Styling:** CSS Modules, Global CSS variables
- **Routing:** React Router DOM
- **Interactions:** `@dnd-kit` for drag-and-drop
- **Icons:** Lucide React

### Backend (`packages/server`)
- **Runtime:** Node.js
- **Framework:** Express
- **Language:** TypeScript
- **Database:** SQLite (via `sql.js`)
- **Real-time:** Server-Sent Events (SSE)

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer recommended)
- npm (comes with Node.js)

## Getting Started

1. **Install dependencies**

   Run this command in the root directory. This will install dependencies for both the client and server workspaces:
   ```bash
   npm install
   ```

2. **Environment Variables**
   
   Navigate to the `packages/client` directory and copy the example environment file:
   ```bash
   cp packages/client/.env.example packages/client/.env
   ```

3. **Start the development servers**

   Start both the frontend and backend simultaneously using concurrently:
   ```bash
   npm run dev
   ```

   - The **client** will be available at: [http://localhost:5173](http://localhost:5173)
   - The **server** will run on: [http://localhost:3001](http://localhost:3001)

4. **Build for Production**

   To build both the client and server for a production environment:
   ```bash
   npm run build
   ```

5. **Start the Production Servers**

   To start both the client (preview) and server simultaneously:
   ```bash
   npm run start
   ```
   Or use `npm run prod` to build and start in one command.

## Project Structure

```text
openboard/
├── package.json          # Root workspace configuration
├── packages/
│   ├── client/           # React frontend application
│   │   ├── src/          # Components, Context, Styles
│   │   └── package.json
│   └── server/           # Express backend application
│       ├── src/          # Routes, Database logic, SSE
│       └── package.json
```
