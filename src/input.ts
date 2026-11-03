type Step = [number, number]

const STEPS: Record<string, Step> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  h: [-1, 0], l: [1, 0], k: [0, -1], j: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
}

export function listenForKeys({
  move,
  rewind,
  isTyping,
}: {
  move: (dx: number, dy: number) => void | Promise<void>
  rewind: () => void | Promise<void>
  isTyping: () => boolean
}): void {
  addEventListener('keydown', (event: KeyboardEvent) => {
    if (isTyping()) {
      return
    }
    const step = STEPS[event.key]
    if (step) {
      void move(...step)
    } else if (event.key === 'u') {
      void rewind()
    } else {
      return
    }
    event.preventDefault()
  })
}
