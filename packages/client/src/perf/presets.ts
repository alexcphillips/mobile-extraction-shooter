/** One-tap stress settings, so the phone needs no URL typing. Each reloads the page. */
const PRESETS: readonly [label: string, search: string][] = [
  ['Default', ''],
  ['0 chars', '?chars=0'],
  ['30 chars', '?chars=30'],
  ['6000 boxes', '?boxes=6000'],
  ['dpr 3', '?dpr=3'],
  ['All', '?chars=30&boxes=6000&dpr=3'],
];

export function mountPresets(el: HTMLElement): void {
  for (const [label, search] of PRESETS) {
    const button = document.createElement('button');
    button.textContent = label;
    button.classList.toggle('active', location.search === search);
    button.addEventListener('click', () => {
      location.search = search;
      // Setting an empty search on a URL without one doesn't navigate.
      if (search === '' && location.search === '') location.reload();
    });
    el.append(button);
  }
}
