"""Un réseau de neurones apprend dix motifs de chiffres, sans dépendance."""
import json
import math
import random
import time

EPOCHS = 80
RATE = 0.18
HIDDEN = 12
rng = random.Random(7)

# Chaque chiffre possède sept rangées de cinq pixels.
glyphs = [
    [14, 17, 19, 21, 25, 17, 14], [4, 12, 4, 4, 4, 4, 14],
    [14, 17, 1, 2, 4, 8, 31], [30, 1, 1, 14, 1, 1, 30],
    [2, 6, 10, 18, 31, 2, 2], [31, 16, 16, 30, 1, 1, 30],
    [6, 8, 16, 30, 17, 17, 14], [31, 1, 2, 4, 8, 8, 8],
    [14, 17, 17, 14, 17, 17, 14], [14, 17, 17, 15, 1, 2, 12],
]
digits = [[(row >> bit) & 1 for row in glyph for bit in range(4, -1, -1)]
          for glyph in glyphs]


def weights(rows, columns):
    return [[rng.uniform(-0.3, 0.3) for _ in range(columns)] for _ in range(rows)]


def layer(values, matrix):
    return [row[-1] + sum(w * x for w, x in zip(row, values)) for row in matrix]


def predict(pixels):
    hidden = [math.tanh(x) for x in layer(pixels, encoder)]
    logits = layer(hidden, classifier)
    scores = [math.exp(x - max(logits)) for x in logits]
    total = sum(scores)
    return hidden, [s / total for s in scores]


def update(matrix, inputs, errors):
    for row, error in zip(matrix, errors):
        for i, x in enumerate(inputs):
            row[i] -= RATE * error * x
        row[-1] -= RATE * error


def digit_svg(label, x, y, size):
    squares = []
    for i, active in enumerate(digits[label]):
        color = "#eee8dc" if active else "#262722"
        squares.append(f'<rect x="{x + i % 5 * size}" y="{y + i // 5 * size}" '
                       f'width="{size - 0.5}" height="{size - 0.5}" fill="{color}"/>')
    return "".join(squares)


def network_svg(epoch, loss, label, hidden, probs, history):
    winner = probs.index(max(probs))
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="400" viewBox="0 0 720 400">',
        '<rect width="720" height="400" rx="12" fill="#151612"/>',
        '<g font-family="Consolas, monospace" fill="#c8c6b9">',
        '<text x="28" y="55" font-family="Georgia, serif" font-size="39" fill="#ede8db">'
        'Neural <tspan fill="#e3a86f" font-style="italic">Network</tspan></text>',
        f'<text x="30" y="88">Époque {epoch:02d} / {EPOCHS}</text>',
        f'<text x="690" y="88" text-anchor="end" fill="#a6cf98">Perte {loss:.3f}</text>',
        digit_svg(label, 32, 145, 16),
        f'<text x="32" y="282">Chiffre {label}</text>',
    ]
    # Each input node summarizes one row of five pixels.
    rows = [sum(digits[label][i:i + 5]) / 5 for i in range(0, 35, 5)]
    layers = [(177, rows), (336, hidden), (500, probs)]

    def pos(i, values):
        return 122 + 172 * i / (len(values) - 1)

    for (x1, left), (x2, right) in zip(layers, layers[1:]):
        for i, a in enumerate(left):
            for j, b in enumerate(right):
                alpha = 0.10 + 0.65 * abs(a * b)
                parts.append(f'<line x1="{x1}" y1="{pos(i, left):.1f}" x2="{x2}" '
                             f'y2="{pos(j, right):.1f}" stroke="#d9a46f" opacity="{alpha:.2f}"/>')
    for x, values in layers:
        for i, activation in enumerate(values):
            y = pos(i, values)
            parts.append(f'<circle cx="{x}" cy="{y:.1f}" r="5" fill="#e7b37a" '
                         f'fill-opacity="{0.15 + 0.85 * abs(activation):.2f}" stroke="#b49b7e"/>')
    for k, p in enumerate(probs):
        y = pos(k, probs)
        parts.extend([
            f'<text x="520" y="{y + 4:.1f}" font-size="12">{k}</text>',
            f'<rect x="540" y="{y - 3:.1f}" width="92" height="6" fill="#282b23"/>',
            f'<rect x="540" y="{y - 3:.1f}" width="{92 * p:.2f}" height="6" fill="#a1c98e"/>',
            f'<text x="688" y="{y + 4:.1f}" text-anchor="end" font-size="12">{p:.0%}</text>',
        ])
    parts.append(f'<text x="30" y="330">Prédiction {winner} · confiance {probs[winner]:.1%}</text>')
    for i, previous_label in enumerate(history):
        parts.append(digit_svg(previous_label, 32 + 30 * i, 350, 4))
    return "".join(parts) + "</g></svg>"


encoder = weights(HIDDEN, 36)
classifier = weights(10, HIDDEN + 1)
history = []
print("Apprentissage de 10 chiffres synthétiques (5 × 7 pixels).")
for epoch in range(1, EPOCHS + 1):
    order = list(range(10))
    rng.shuffle(order)
    loss = 0
    for label in order:
        pixels = digits[label]
        hidden, probs = predict(pixels)
        loss -= math.log(probs[label])
        errors = [p - (i == label) for i, p in enumerate(probs)]
        gradient = [(1 - h * h) * sum(errors[k] * classifier[k][j] for k in range(10))
                    for j, h in enumerate(hidden)]
        update(classifier, hidden, errors)
        update(encoder, pixels, gradient)

    label = (epoch + 5) % 10
    hidden, probs = predict(digits[label])
    history = (history + [label])[-16:]
    svg = network_svg(epoch, loss / 10, label, hidden, probs, history)
    print("@live " + json.dumps({"svg": svg}), flush=True)
    if epoch % 10 == 0:
        print(f"Époque {epoch:02d}   perte moyenne {loss / 10:.4f}")
    time.sleep(0.1)
