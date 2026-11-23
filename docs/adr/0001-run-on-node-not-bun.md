# Run the bot on Node, not Bun

Voice requires `@discordjs/voice`, whose native Opus and DAVE dependencies are only supported on Node (>=22.12). Bun has open issues with installing `@discordjs/opus` and with voice in general (oven-sh/bun#11313, #12554), and receiving audio under DAVE is untested there. We therefore run the whole bot on Node 22+ in a Node Alpine image. Bun may still be used as a package manager, but not as the runtime. The `oven/bun` base image used to run `node index.js` through Bun, so earlier deployments were never actually on Node.
