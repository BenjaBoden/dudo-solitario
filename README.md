# Dudo Solitario

Juego de **Dudo / Cacho** para el navegador. Juegas solo contra 1 a 5 bots.

## Cómo jugar

Abre `index.html` en el navegador. No necesita instalación ni servidor.

## Reglas incluidas

- 5 dados por jugador. Los ases son comodines.
- Para subir: más dados, o la misma cantidad con una pinta más alta.
- Pasar a ases: la mitad (redondeada hacia arriba). Salir de ases: el doble + 1.
- **Dudo**: pierde un dado quien estaba equivocado.
- **Calzo**: si aciertas la cantidad exacta, recuperas un dado. Si fallas, pierdes uno.
- Gana el último jugador con dados.

## Archivos

- `index.html`: estructura de la página
- `style.css`: estilos (mesa de paño, dados en CSS)
- `game.js`: reglas, IA de los bots (probabilística, con 3 dificultades) e interfaz
