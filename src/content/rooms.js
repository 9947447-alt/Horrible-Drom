// 六个宿舍：尺寸、起始道具、装饰与房间气质均不同。
// 坐标原点为房间左上角；床占左侧 2x2；门位于南墙中央。

export const ROOMS = [
  {
    id: 'room-301',
    number: '301',
    name: '老宿舍',
    subtitle: '模板开局，四平八稳',
    w: 6,
    h: 5,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 5, y: 0 }, { x: 0, y: 4 }],
    starter: { type: 'acid', stage: 1, level: 1, tile: { x: 4, y: 2 } },
    theme: 'wood',
    accent: '#ffc75a',
    desc: '书桌、暖水瓶和一台老风扇。没有惊喜，也没有短板。',
    props: ['fan', 'thermos', 'poster'],
  },
  {
    id: 'room-302',
    number: '302',
    name: '靠楼梯间',
    subtitle: '窄，但离走廊最近',
    w: 5,
    h: 5,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 4, y: 0 }, { x: 4, y: 4 }],
    starter: { type: 'analyzer', level: 1, tile: { x: 3, y: 1 } },
    theme: 'teal',
    accent: '#63e0c2',
    desc: '门外的脚步声听得一清二楚。层析仪已经架好，适合先手发育。',
    props: ['pipes', 'thermos'],
  },
  {
    id: 'room-303',
    number: '303',
    name: '转角大房',
    subtitle: '地方大，摆得开',
    w: 7,
    h: 5,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 6, y: 0 }, { x: 6, y: 1 }],
    starter: { type: 'condenser', level: 1, tile: { x: 5, y: 3 } },
    theme: 'amber',
    accent: '#ffb45e',
    desc: '旧书柜占了半面墙，剩余空间足够搭两条反应链。冷凝器是前任租客留下的。',
    props: ['bookshelf', 'poster', 'plant'],
  },
  {
    id: 'room-304',
    number: '304',
    name: '阳台房',
    subtitle: '通风好，毒气散得快',
    w: 6,
    h: 4,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 5, y: 3 }],
    starter: { type: 'catalyst', level: 1, tile: { x: 4, y: 1 } },
    theme: 'moon',
    accent: '#9ecbff',
    desc: '阳台门漏风，但也漏进一点月光。催化台已经预热，适合反应流。',
    props: ['balcony', 'laundry', 'plant'],
  },
  {
    id: 'room-305',
    number: '305',
    name: '阁楼',
    subtitle: '又小又斜，但够暖',
    w: 5,
    h: 4,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 4, y: 0 }],
    starter: { type: 'chlorate', level: 1, tile: { x: 3, y: 2 } },
    theme: 'attic',
    accent: '#e7a37a',
    desc: '斜屋顶压得人喘不过气，氯酸钾炮台占掉了最后一块空地。',
    props: ['slope', 'boxes', 'lamp'],
  },
  {
    id: 'room-306',
    number: '306',
    name: '尽头房',
    subtitle: '最安静，也最容易被堵死',
    w: 6,
    h: 6,
    bed: { x: 0, y: 0, w: 2, h: 2 },
    blocked: [{ x: 5, y: 4 }, { x: 5, y: 5 }],
    starter: { type: 'atm', level: 1, tile: { x: 4, y: 2 } },
    theme: 'deep',
    accent: '#c7a8ff',
    desc: '走廊尽头，很少有人经过。梦能提款机是上一届学长留下的，接上它就能把伤害变成钱。',
    props: ['desk', 'mirror', 'poster'],
  },
];

export const ROOM_LOOKUP = Object.fromEntries(ROOMS.map((room) => [room.id, room]));

export const ROOMMATE_NAMES = [
  { name: '阿凯', color: '#ffb45e', note: '经济流', trait: 'economist' },
  { name: '小满', color: '#63e0c2', note: '炮台流', trait: 'gunner' },
  { name: '老白', color: '#9ecbff', note: '龟缩流', trait: 'turtle' },
  { name: '雨桐', color: '#e7a37a', note: '反应流', trait: 'chemist' },
  { name: '六六', color: '#c7a8ff', note: '运气流', trait: 'lucky' },
];

export function getRoom(roomId) {
  return ROOM_LOOKUP[roomId] || ROOMS[0];
}

export function isBuildableTile(room, tile) {
  if (!room || !tile) return false;
  const { x, y } = tile;
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < 0 || y < 0 || x >= room.w || y >= room.h) return false;
  const b = room.bed;
  if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return false;
  return !room.blocked.some((p) => p.x === x && p.y === y);
}
