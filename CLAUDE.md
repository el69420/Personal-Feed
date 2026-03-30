# Personal Feed — Claude Instructions

## Before changing anything that affects how features work

Always ask the user before making changes that:
- Change how existing features communicate with external services (APIs, servers, databases)
- Add new requirements or setup steps (environment variables, config files, dependencies)
- Could cause a feature to stop working if the user just reloads the page or restarts the server

Describe what the change does and what the user would need to do differently, and get a yes before proceeding.

This applies even when the change is an improvement (e.g. security fixes, refactors). If it might break something or require extra setup, ask first.
