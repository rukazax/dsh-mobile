# Инструкция и иллюстрации

Здесь лежит готовый PDF-мануал и его исходники.

| Файл | Что это |
|---|---|
| `DSH-Mobile-Инструкция.pdf` | готовая инструкция: 19 страниц A4, скриншоты + схемы |
| `guide.html` | исходник вёрстки (печать через Chrome `--print-to-pdf`) |
| `screens/*.png` | реальные скриншоты PWA (Chromium, device scale 2), включая светлую тему, поиск и подтверждения |
| `diagrams/diagram.html`, `diagrams/work.html` | исходники схем (inline SVG: `?d=arch\|pairing\|sync\|foldable\|install\|prompt\|events\|security\|approvals`); `work.html` — схемы работы |
| `diagrams/*.png` | отрендеренные схемы |

## Как перегенерировать

```powershell
# скриншоты PWA (нужен полный доступ: Chromium требует named pipes)
node research\tools\capture-public-shots.mjs   # привязка без приватных данных + новые экраны
node research\tools\cdp-capture2.mjs      # базовые экраны + широкий режим
node research\tools\cdp-capture3.mjs      # вопрос + pairing-страница на ПК
node research\tools\cdp-capture5.mjs      # approval/question без клика
node research\tools\cdp-capture7.mjs      # approval с кликом

# схемы
#   Chrome screenshot diagram.html?d=<name>, затем
python research\tools\crop_diagrams.py docs\guide\diagrams\*.png

# проверка, что каждая глава влезает в одну страницу A4
node research\tools\measure-guide.mjs docs\guide\guide.html research\tmp\guide-shots

# PDF
chrome --headless=new --no-sandbox --no-pdf-header-footer `
  --print-to-pdf=docs\guide\DSH-Mobile-Инструкция.pdf `
  file:///<abs>/docs/guide/guide.html
```

## Замечания

- Скриншоты сняты в **демо-режиме** PWA (`?demo=1`) — это те же компоненты интерфейса,
  что и в рабочем режиме; данные демонстрационные.
- Скриншот `11-pair-page-pc.png` — **реальная** страница `/m/pair`, отданная плагином
  в изолированном экземпляре DSH (код и устройства демонстрационные).
- Схемы нарисованы вручную в SVG (не Mermaid), чтобы точно передать поток данных.
- Если правите главы, прогоните `measure-guide.mjs`: все секции должны быть ≤ 1123 px
  (одна страница A4 при 96 dpi), иначе PDF добавит пустые страницы.

