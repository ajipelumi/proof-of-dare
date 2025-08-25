# Proof of Dare

A decentralized challenge platform built on the Stacks blockchain using Clarity smart contracts. Proof of Dare enables users to create, accept, and vote on challenges with STX stakes, fostering accountability and community engagement through a transparent voting mechanism.

## 🎯 Core Features

- **Challenge Creation**: Users can create truth or dare challenges with customizable stakes
- **Decentralized Voting**: Community members vote on challenge completion using a commit-reveal scheme
- **Reputation System**: Earn reputation points for participation and successful challenge completion
- **Stake Management**: Automatic distribution of stakes based on voting outcomes
- **Time-based Windows**: Structured time periods for accepting challenges, voting, and resolution
- **Badge System**: Mint reputation badges for users with high reputation scores

## 🏗️ Architecture

### Challenge Lifecycle

1. **Creation**: A challenger creates a challenge with a stake and description
2. **Acceptance**: The challengee accepts the challenge within the acceptance window
3. **Voting**: Community members commit and reveal votes on challenge completion
4. **Resolution**: Stakes are distributed based on voting results

### Challenge Types

- **Truth Challenges** (`TYPE_TRUTH`): Verification-based challenges
- **Dare Challenges** (`TYPE_DARE`): Action-based challenges

### Status Flow

```plaintext
PENDING → ACTIVE → VOTING → RESOLVED
    ↓
  EXPIRED
```

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) package manager
- [Clarinet](https://github.com/hirosystems/clarinet) CLI tool
- [Stacks Wallet](https://wallet.hiro.so/) for mainnet/testnet deployment

## 🚀 Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd proof-of-dare
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Verify Clarinet installation**

   ```bash
   clarinet --version
   ```

## ⚙️ Configuration

### Environment Setup

The project uses Clarinet for local development and testing. Configuration is managed through:

- `Clarinet.toml`: Project configuration and contract definitions
- `vitest.config.js`: Test environment configuration
- `tsconfig.json`: TypeScript configuration

### Contract Parameters

```clarity
;; Minimum stake requirement
MIN_STAKE: 1,000,000 microSTX (1 STX)

;; Time windows (in blocks)
ACCEPT_WINDOW: 144 blocks (~24 hours)
COMMIT_WINDOW: 144 blocks (~24 hours)
REVEAL_WINDOW: 144 blocks (~24 hours)
```

## 💻 Usage Examples

### Creating a Challenge

```typescript
// Create a dare challenge
const receipt = simnet.callPublicFn(
  "proof-of-dare",
  "create-challenge",
  [
    principalCV(challengeeAddress),
    uintCV(1), // TYPE_DARE
    stringAsciiCV("Complete 100 pushups"),
    uintCV(2_000_000), // 2 STX stake
  ],
  challengerAddress
);
```

### Accepting a Challenge

```typescript
// Accept challenge with ID 1
const receipt = simnet.callPublicFn(
  "proof-of-dare",
  "accept-challenge",
  [uintCV(1)],
  challengeeAddress
);
```

### Voting Process

```typescript
// 1. Commit vote (hidden)
const nonce = Buffer.from("random-nonce-32-bytes-long-string", "utf8");
const commitHash = sha256(concat(vote === 1 ? 0x01 : 0x02, nonce));

const commitReceipt = simnet.callPublicFn(
  "proof-of-dare",
  "commit-vote",
  [uintCV(1), bufferCV(commitHash)],
  voterAddress
);

// 2. Reveal vote (after commit window)
const revealReceipt = simnet.callPublicFn(
  "proof-of-dare",
  "reveal-vote",
  [
    uintCV(1),
    uintCV(1), // 1 = completed, 2 = not completed
    bufferCV(nonce),
  ],
  voterAddress
);
```

### Resolving a Challenge

```typescript
// Resolve challenge after voting period ends
const receipt = simnet.callPublicFn(
  "proof-of-dare",
  "resolve-challenge",
  [uintCV(1)],
  anyAddress
);
```

## 🧪 Testing

### Run Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage and cost analysis
pnpm run test:report

# Watch mode for development
pnpm run test:watch
```

### Test Structure

Tests are located in the `tests/` directory and use Vitest with Clarinet SDK:

- `proof-of-dare.test.ts`: Comprehensive test suite covering all contract functions
- Tests include challenge lifecycle, voting mechanisms, and edge cases

## 📚 API Documentation

### Public Functions

#### `create-challenge`

Creates a new challenge with specified parameters.

**Parameters:**

- `challengee` (principal): Address of the person being challenged
- `challenge-type` (uint): Type of challenge (0 = truth, 1 = dare)
- `description` (string-ascii 500): Challenge description
- `stake` (uint): Stake amount in microSTX

**Returns:** Challenge ID on success

#### `accept-challenge`

Accepts a pending challenge.

**Parameters:**

- `id` (uint): Challenge ID

**Returns:** Boolean success indicator

#### `start-voting`

Initiates the voting phase for an active challenge.

**Parameters:**

- `id` (uint): Challenge ID

**Returns:** Boolean success indicator

#### `commit-vote`

Submits a hidden vote commitment.

**Parameters:**

- `id` (uint): Challenge ID
- `commit` (buff 32): SHA256 hash of vote + nonce

**Returns:** Boolean success indicator

#### `reveal-vote`

Reveals a previously committed vote.

**Parameters:**

- `id` (uint): Challenge ID
- `vote` (uint): Vote value (1 = completed, 2 = not completed)
- `nonce` (buff 32): Random nonce used in commit

**Returns:** Boolean success indicator

#### `resolve-challenge`

Resolves a challenge and distributes stakes based on voting results.

**Parameters:**

- `id` (uint): Challenge ID

**Returns:** Winner's principal address

#### `refund-expired-challenge`

Refunds stake for expired unaccepted challenges.

**Parameters:**

- `id` (uint): Challenge ID

**Returns:** Boolean success indicator

### Read-Only Functions

#### `get-challenge`

Retrieves challenge details by ID.

#### `get-user-reputation`

Returns user's reputation score.

#### `get-vote-commit` / `get-vote-reveal`

Retrieve voting information for specific challenge and voter.

### Error Codes

| Code | Constant                       | Description                     |
| ---- | ------------------------------ | ------------------------------- |
| u100 | ERR_UNAUTHORIZED               | Caller not authorized           |
| u101 | ERR_INVALID_STAKE              | Invalid stake amount            |
| u102 | ERR_CHALLENGE_NOT_FOUND        | Challenge doesn't exist         |
| u103 | ERR_CHALLENGE_EXPIRED          | Challenge has expired           |
| u104 | ERR_CHALLENGE_ALREADY_ACCEPTED | Challenge already accepted      |
| u105 | ERR_INSUFFICIENT_FUNDS         | Insufficient STX balance        |
| u106 | ERR_VOTING_NOT_ACTIVE          | Voting phase not active         |
| u107 | ERR_ALREADY_VOTED              | User already voted              |
| u108 | ERR_INVALID_VOTE               | Invalid vote format             |
| u109 | ERR_REVEAL_PERIOD_ENDED        | Reveal period has ended         |
| u110 | ERR_CHALLENGE_NOT_RESOLVED     | Challenge not in resolved state |
| u111 | ERR_SELF_CHALLENGE             | Cannot challenge yourself       |

## 🤝 Contributing

### Development Workflow

1. **Fork the repository**
2. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
4. **Run tests**

   ```bash
   pnpm test
   ```

5. **Commit your changes**

   ```bash
   git commit -m "Add: your feature description"
   ```

6. **Push to your fork**

   ```bash
   git push origin feature/your-feature-name
   ```

7. **Create a Pull Request**

### Code Standards

- Follow existing code style and conventions
- Add tests for new functionality
- Ensure all tests pass before submitting
- Use clear, descriptive commit messages
- Update documentation for API changes

### Testing Guidelines

- Write comprehensive tests for new features
- Test both success and failure scenarios
- Include edge cases and boundary conditions
- Maintain test coverage above 90%

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🔗 Resources

- [Stacks Documentation](https://docs.stacks.co/)
- [Clarity Language Reference](https://docs.stacks.co/clarity/)
- [Clarinet Documentation](https://github.com/hirosystems/clarinet)
- [Stacks.js Documentation](https://stacks.js.org/)

## 🆘 Support

For questions, issues, or contributions:

- GitHub Issues: [Create an issue](https://github.com/ajipelumi/proof-of-dare/issues)
- Email: <ajisafeoluwapelumi@gmail.com>
- Twitter: [@the_pelumi](https://twitter.com/ajipelumi)

---

Built with ❤️ on Stacks blockchain
