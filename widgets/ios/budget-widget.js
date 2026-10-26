// Бюджет — виджет для приложения Scriptable (iPhone), размер «средний».
// Слева «Внести», справа «Отчёт». Тап открывает веб-приложение в Safari.
// Установка и обновления: https://malyavin777.github.io/budget/widgets/
// Данных бюджета и кода доступа здесь нет.

const APP = 'https://malyavin777.github.io/budget/';
const ASSETS = APP + 'widgets/ios/';
const VERSION = 1;

// Размер среднего виджета (pt) по размеру экрана
const SIZES = {
  '430x932': [364, 170], '428x926': [364, 170], '440x956': [364, 170],
  '414x896': [360, 169], '414x736': [348, 157],
  '402x874': [344, 162], '393x852': [338, 158], '390x844': [338, 158],
  '375x812': [329, 155], '360x780': [329, 155], '375x667': [321, 148],
  '320x568': [292, 141],
};

function widgetSize() {
  const s = Device.screenSize();
  const w = Math.min(s.width, s.height);
  const h = Math.max(s.width, s.height);
  const hit = SIZES[w + 'x' + h];
  if (hit) return hit;
  return [Math.round(w * 0.865), Math.round(w * 0.405)];
}

async function image(name) {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), 'budget-widget-v' + VERSION);
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  const path = fm.joinPath(dir, name);
  if (fm.fileExists(path)) return fm.readImage(path);
  try {
    const img = await new Request(ASSETS + name).loadImage();
    fm.writeImage(path, img);
    return img;
  } catch (e) {
    return null; // без сети — простой градиент
  }
}

function addButton(row, o) {
  const s = row.addStack();
  s.size = new Size(o.w, o.h);
  s.cornerRadius = 22;
  s.layoutVertically();
  s.setPadding(14, 14, 12, 14);
  s.url = o.url;
  if (o.bg) {
    s.backgroundImage = o.bg;
  } else {
    const g = new LinearGradient();
    g.colors = [new Color(o.colors[0]), new Color(o.colors[1])];
    g.locations = [0, 1];
    s.backgroundGradient = g;
  }

  const circle = s.addStack();
  circle.size = new Size(40, 40);
  circle.cornerRadius = 20;
  circle.backgroundColor = new Color('#FFFFFF', 0.18);
  circle.borderColor = new Color('#FFFFFF', 0.28);
  circle.borderWidth = 1;
  circle.centerAlignContent();
  const sym = SFSymbol.named(o.symbol);
  sym.applyFont(Font.boldSystemFont(17));
  const icon = circle.addImage(sym.image);
  icon.imageSize = new Size(19, 19);
  icon.tintColor = Color.white();

  s.addSpacer();

  const title = s.addText(o.title);
  title.font = Font.heavySystemFont(20);
  title.textColor = Color.white();
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.8;

  const sub = s.addText(o.sub);
  sub.font = Font.semiboldSystemFont(12);
  sub.textColor = new Color('#FFFFFF', 0.78);
  sub.lineLimit = 1;
  sub.minimumScaleFactor = 0.8;
}

async function build() {
  const [W, H] = widgetSize();
  const pad = 11;
  const gap = 10;
  const bw = Math.floor((W - pad * 2 - gap) / 2);
  const bh = H - pad * 2;

  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color('#F2EDE3'), new Color('#0B0D14'));
  w.setPadding(pad, pad, pad, pad);
  w.url = APP + '#add';
  w.refreshAfterDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);

  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  addButton(row, {
    w: bw, h: bh, url: APP + '#add', bg: await image('btn-add.png'),
    colors: ['#FF8A4D', '#1C100D'], symbol: 'plus', title: 'Внести', sub: 'расход · доход',
  });
  row.addSpacer(gap);
  addButton(row, {
    w: bw, h: bh, url: APP + '#report', bg: await image('btn-report.png'),
    colors: ['#5B6BFF', '#0C0F22'], symbol: 'chart.bar.fill', title: 'Отчёт', sub: 'план и факт',
  });
  return w;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
