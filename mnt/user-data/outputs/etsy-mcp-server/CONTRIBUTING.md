# Contributing to Etsy MCP Server

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the Etsy MCP Server project.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on what is best for the community
- Show empathy towards other community members

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Your environment (OS, Node.js version, etc.)
- Any relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please create an issue with:
- A clear, descriptive title
- Detailed description of the proposed feature
- Why this enhancement would be useful
- Possible implementation approach (if you have one)

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes**:
   - Write clear, concise commit messages
   - Follow the existing code style
   - Add or update tests as needed
   - Update documentation as needed
3. **Test your changes**:
   ```bash
   npm install
   npm run build
   ```
4. **Submit a pull request** with:
   - A clear description of the changes
   - Reference to any related issues
   - Screenshots (if applicable)

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm
- An Etsy API key

### Getting Started

1. Clone your fork:
   ```bash
   git clone https://github.com/your-username/etsy-mcp-server.git
   cd etsy-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   export ETSY_API_KEY=your_api_key_here
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Test locally:
   ```bash
   npm run dev
   ```

## Project Structure

```
etsy-mcp-server/
├── src/
│   └── index.ts          # Main server implementation
├── build/                # Compiled JavaScript output
├── .github/
│   └── workflows/
│       └── ci.yml        # GitHub Actions CI/CD
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
├── README.md             # Main documentation
├── EXAMPLES.md           # Usage examples
├── CHANGELOG.md          # Version history
└── CONTRIBUTING.md       # This file
```

## Coding Guidelines

### TypeScript

- Use TypeScript for all code
- Enable strict mode
- Define proper types/interfaces
- Avoid `any` types when possible

### Code Style

- Use 2 spaces for indentation
- Use semicolons
- Use double quotes for strings
- Follow existing naming conventions:
  - `camelCase` for variables and functions
  - `PascalCase` for classes and types
  - `UPPER_CASE` for constants

### Error Handling

- Always handle errors appropriately
- Provide meaningful error messages
- Log errors to stderr for debugging
- Return user-friendly error responses

### Documentation

- Update README.md for user-facing changes
- Add JSDoc comments for functions
- Update EXAMPLES.md with new use cases
- Update CHANGELOG.md following Keep a Changelog format

## Adding New Tools

When adding a new Etsy API endpoint:

1. **Define the tool** in the `TOOLS` array:
   ```typescript
   {
     name: "tool_name",
     description: "Clear description",
     inputSchema: {
       type: "object",
       properties: { /* parameters */ },
       required: [ /* required params */ ]
     }
   }
   ```

2. **Implement the handler function**:
   ```typescript
   async function handleToolName(args: any) {
     // Validate parameters
     // Make API request
     // Transform response
     // Return formatted result
   }
   ```

3. **Add to switch statement** in `CallToolRequestSchema` handler

4. **Update documentation**:
   - Add tool description to README.md
   - Add usage examples to EXAMPLES.md
   - Update CHANGELOG.md

5. **Test thoroughly**:
   - Test with valid inputs
   - Test edge cases
   - Test error conditions

## Testing

Currently, the project uses manual testing. When adding features:

1. Test with the MCP Inspector or Claude Desktop
2. Verify all parameters work correctly
3. Test error conditions
4. Verify pagination works (if applicable)
5. Check rate limiting behavior

Future: We plan to add automated tests using Jest or similar.

## Version Numbering

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** version for incompatible API changes
- **MINOR** version for backwards-compatible functionality
- **PATCH** version for backwards-compatible bug fixes

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Commit: `git commit -am "Release vX.Y.Z"`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push && git push --tags`
6. GitHub Actions will automatically publish to npm

## Questions?

Feel free to open an issue for any questions about contributing!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
