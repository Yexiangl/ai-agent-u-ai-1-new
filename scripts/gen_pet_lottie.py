#!/usr/bin/env python3
"""Generate a small, valid Lottie JSON for the virtual pet (breathing blob with
blinking eyes). Hand-writing Lottie keyframes is error-prone, so we compute them
here and emit a static asset. Re-run to regenerate. No external deps."""
import json, os

W = H = 200
FR = 30
OP = 90  # 3s loop

def ellipse(size, pos, color, name):
    return {
        "ty": "gr", "nm": name, "it": [
            {"ty": "el", "p": {"a": 0, "k": pos}, "s": {"a": 0, "k": size}, "nm": "ellipse"},
            {"ty": "fl", "c": {"a": 0, "k": color}, "o": {"a": 0, "k": 100}, "nm": "fill"},
            {"ty": "tr", "p": {"a": 0, "k": [0, 0]}, "a": {"a": 0, "k": [0, 0]},
             "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": {"a": 0, "k": 100}},
        ],
    }


def body_layer(color):
    # Breathing squash/stretch via scale keyframes (ease in/out).
    def kf(t, s):
        return {"t": t, "s": s, "i": {"x": [0.4, 0.4], "y": [1, 1]}, "o": {"x": [0.6, 0.6], "y": [0, 0]}}
    return {
        "ddd": 0, "ind": 1, "ty": 4, "nm": "body", "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 0, "k": 0},
            "p": {"a": 0, "k": [100, 112, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 1, "k": [kf(0, [100, 100, 100]), kf(45, [106, 92, 100]), kf(90, [100, 100, 100])]},
        },
        "shapes": [ellipse([120, 110], [0, 0], color, "blob")],
        "ip": 0, "op": OP, "st": 0, "bm": 0,
    }


def eyes_layer():
    # Blink: eyes scale to a slit near the end of the loop.
    def kf(t, s):
        return {"t": t, "s": s, "i": {"x": [0.7], "y": [1]}, "o": {"x": [0.3], "y": [0]}}
    blink = {"a": 1, "k": [kf(0, [100, 100, 100]), kf(70, [100, 100, 100]), kf(75, [100, 10, 100]), kf(80, [100, 100, 100])]}
    return {
        "ddd": 0, "ind": 2, "ty": 4, "nm": "eyes", "sr": 1,
        "ks": {"o": {"a": 0, "k": 100}, "r": {"a": 0, "k": 0}, "p": {"a": 0, "k": [100, 100, 0]},
               "a": {"a": 0, "k": [0, 0, 0]}, "s": blink},
        "shapes": [
            ellipse([16, 16], [-26, 0], [0.15, 0.15, 0.2, 1], "eyeL"),
            ellipse([16, 16], [26, 0], [0.15, 0.15, 0.2, 1], "eyeR"),
        ],
        "ip": 0, "op": OP, "st": 0, "bm": 0,
    }


def cheeks_layer():
    return {
        "ddd": 0, "ind": 3, "ty": 4, "nm": "cheeks", "sr": 1,
        "ks": {"o": {"a": 0, "k": 70}, "r": {"a": 0, "k": 0}, "p": {"a": 0, "k": [100, 118, 0]},
               "a": {"a": 0, "k": [0, 0, 0]}, "s": {"a": 0, "k": [100, 100, 100]}},
        "shapes": [
            ellipse([14, 9], [-40, 0], [1, 0.6, 0.65, 1], "cheekL"),
            ellipse([14, 9], [40, 0], [1, 0.6, 0.65, 1], "cheekR"),
        ],
        "ip": 0, "op": OP, "st": 0, "bm": 0,
    }


def build(color, out_name):
    doc = {
        "v": "5.7.4", "fr": FR, "ip": 0, "op": OP, "w": W, "h": H, "nm": out_name, "ddd": 0,
        "assets": [], "layers": [cheeks_layer(), eyes_layer(), body_layer(color)],
    }
    return doc


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.normpath(os.path.join(here, "..", "src", "assets"))
    os.makedirs(out_dir, exist_ok=True)
    # One palette per evolution stage so the pet visibly changes as it grows.
    variants = {
        "pet-egg": [0.85, 0.88, 0.95, 1],
        "pet-baby": [0.66, 0.78, 0.98, 1],
        "pet-teen": [0.56, 0.86, 0.7, 1],
        "pet-adult": [0.75, 0.66, 0.98, 1],
    }
    for name, color in variants.items():
        doc = build(color, name)
        with open(os.path.join(out_dir, name + ".json"), "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        print("wrote", name + ".json")


if __name__ == "__main__":
    main()
