@echo off
rem pnpm shim for this workspace: only the bundled pnpm exists in this install
rem (C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm),
rem and `dsh plugin` resolves the command name `pnpm` through PATH.
rem Prepend this directory to PATH (research/test-instance.md), never install it globally.
"C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" "C:\Users\<user>\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" %*
