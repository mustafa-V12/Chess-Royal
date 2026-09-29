# Chess Royale

A complete chess game that runs in your web browser.

Play against the computer with 3 difficulty levels, or play with a friend on the same device. No account or installation is required.

## Features

- Play against the computer
- 3 AI difficulty levels
- Local 2-player mode
- Chess clock
- Choose White, Black, or Random
- Castling, en passant and pawn promotion
- Check, checkmate and draw detection
- Move highlighting
- Mouse and touch controls
- Responsive design

## Technologies

HTML, CSS and JavaScript, using chess.js for chess rules and a custom AI using Minimax, Alpha-Beta pruning and other search techniques.

## How to Run

The game needs to run through a local server.

Using VS Code:
1. Open the project in VS Code.
2. Install the Live Server extension.
3. Right-click `index.html`.
4. Select **Open with Live Server**.

Or use:

`npx serve .`

or:

`python -m http.server 8000`

## Project Structure

chess-royale/
├── index.html
├── css/
├── js/
├── assets/
├── lib/
└── tests/

## Testing

Run the AI tests with:

`node tests/engine.test.mjs`

## AI

The computer opponent uses Minimax, Alpha-Beta pruning, move ordering, quiescence search, transposition tables and iterative deepening.

The AI runs in a Web Worker so the game remains responsive while the computer is thinking.

## Limitations

This version does not include online multiplayer, user accounts, leaderboards, saved games or game analysis.

## License

The project code can be used and modified freely.

`chess.js` is used under its BSD license. See `lib/LICENSE-chess.js.txt`.

## Credits

Built with HTML, CSS and JavaScript.

The project was planned and tested by me, with code developed together with Claude (Anthropic).
