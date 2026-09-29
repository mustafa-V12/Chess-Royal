# Ljud

Den här mappen är avsiktligt tom på ljudfiler.

Spelets ljud skapas i stället direkt i koden med Web Audio API, i `js/audio.js`.
Varje ljud byggs av ett par toner som tonar ut. Fördelarna är att appen inte
behöver ladda ner något, fungerar utan internet och inte drar med sig filer med
oklara licenser.

## Vill du använda riktiga ljudfiler i stället?

1. Lägg dina filer här, till exempel `move.wav` och `capture.wav`.
2. Öppna `js/audio.js` och byt ut innehållet i `playTone` mot en vanlig
   `new Audio('assets/sounds/move.wav').play()`.

Funktionerna heter `sounds.move()`, `sounds.capture()`, `sounds.check()`,
`sounds.gameStart()` och `sounds.gameEnd()`, så du behöver bara ändra på ett ställe.
