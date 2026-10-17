/**
 * Resets the dev database with sample data: the product catalog, discount codes and about
 * six weeks of orders. Deterministic: the same seed gives the same data (relative to today).
 */
import { pool } from '../src/db';
import { percentOfCents, toCents } from '../src/money';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(42);
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const now = new Date();
const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const catalogAdded = [
  { at: new Date(startOfTodayUtc - 120 * DAY + 10 * HOUR), size: 24 },
  { at: new Date(startOfTodayUtc - 60 * DAY + 10 * HOUR), size: 20 },
  { at: new Date(startOfTodayUtc - 20 * DAY + 10 * HOUR), size: 16 },
];

const catalog: [string, number][] = [
  ['Everyday Tee', 19.99], ['Heavyweight Tee', 24.95], ['Pocket Tee', 21.99], ['Long Sleeve Tee', 29.99],
  ['Crewneck Sweatshirt', 49.95], ['Zip Hoodie', 59.99], ['Pullover Hoodie', 54.95], ['Fleece Joggers', 44.99],
  ['Canvas Tote', 18.49], ['Market Tote', 24.99], ['Weekender Bag', 89.95], ['Sling Bag', 34.95],
  ['Wool Beanie', 22.49], ['Dad Cap', 19.95], ['Bucket Hat', 26.99], ['Merino Socks (2 pack)', 16.99],
  ['Crew Socks (3 pack)', 12.49], ['Enamel Mug', 14.99], ['Stoneware Mug', 17.95], ['Travel Tumbler', 27.49],
  ['Pour-Over Set', 39.99], ['Ceramic Planter', 32.95], ['Linen Napkins (4)', 28.49], ['Cotton Throw', 64.99],
  ['Scented Candle', 21.95], ['Soy Candle Trio', 36.99], ['Incense Holder', 12.95], ['Bamboo Tray', 23.49],
  ['Glass Carafe', 29.95], ['Coaster Set', 15.49], ['Hardcover Notebook', 16.95], ['Dot Grid Journal', 18.99],
  ['Weekly Planner', 22.95], ['Sticker Pack', 6.99], ['Enamel Pin', 9.95], ['Gel Pen Set', 11.49],
  ['Brass Bookmark', 13.95], ['Desk Organizer', 34.49], ['Art Print A3', 29.99], ['Art Print A4', 19.49],
  ['Greeting Cards (5)', 14.95], ['Washi Tape Set', 10.99], ['Leather Keychain', 17.49], ['Card Wallet', 39.95],
  ['Phone Case', 27.99], ['Laptop Sleeve', 44.95], ['Cable Pouch', 19.99], ['Water Bottle', 31.49],
  ['Picnic Blanket', 74.95], ['Camp Mug', 18.95], ['Trail Cap', 24.49], ['Rain Shell', 119.0],
  ['Fleece Vest', 69.99], ['Knit Scarf', 34.95], ['Gift Card Holder', 4.99], ['Gift Wrap Kit', 12.99],
  ['Mini Candle', 9.49], ['Pin Set', 21.95], ['Poster Tube', 7.49],
];

const firstNames = ['ava', 'liam', 'noah', 'mia', 'zara', 'omar', 'lena', 'ravi', 'chen', 'sofia', 'jonas', 'ines', 'kai', 'nora', 'amir', 'yuki'];
const lastNames = ['patel', 'garcia', 'kim', 'nguyen', 'okafor', 'muller', 'rossi', 'silva', 'cohen', 'singh', 'larsen', 'haddad'];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE order_items, orders, discount_codes, products RESTART IDENTITY CASCADE');

    // Products
    const products: { id: number; price: number }[] = [];
    let index = 0;
    for (const group of catalogAdded) {
      for (let i = 0; i < group.size; i++, index++) {
        const isHoodieDrop = index === catalog.length;
        const [name, dollars] = isHoodieDrop ? ['Limited Edition Hoodie', 64.0] : catalog[index];
        const price = toCents(dollars);
        const sku = isHoodieDrop ? 'LTD-HOODIE' : `SKU-${String(1000 + index)}`;
        const stock = isHoodieDrop ? 5 : [7, 18, 33].includes(index) ? between(1, 4) : between(15, 180);
        const { rows } = await client.query(
          'INSERT INTO products (sku, name, price, stock, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [sku, name, price, stock, group.at],
        );
        if (!isHoodieDrop) products.push({ id: rows[0].id, price });
      }
    }

    // Discount codes
    await client.query(
      `INSERT INTO discount_codes (code, percent_off, max_uses, used_count, expires_at) VALUES
        ('WELCOME-ONCE', 10, 1, 0, NULL),
        ('SUMMER15', 15, 1000, 0, NULL),
        ('SPRING20', 20, NULL, 0, $1)`,
      [new Date(startOfTodayUtc - 90 * DAY)],
    );

    // Orders: last 45 days. The store was offline 9-11 days ago.
    const outage = new Set([9, 10, 11]);
    const bulkDays = new Set([3, 17]);
    let orderCount = 0;
    let summerUses = 0;

    for (let daysAgo = 45; daysAgo >= 0; daysAgo--) {
      if (outage.has(daysAgo)) continue;
      const dayStart = startOfTodayUtc - daysAgo * DAY;
      const weekday = new Date(dayStart).getUTCDay();
      const count = bulkDays.has(daysAgo)
        ? 2
        : between(6, 14) + (weekday === 0 || weekday === 6 ? 4 : 0);

      const times = Array.from({ length: count }, () => dayStart + 12 * HOUR + Math.floor(random() * 16 * HOUR))
        .filter((t) => t < now.getTime())
        .sort((a, b) => a - b);

      for (const time of times) {
        const lineCount = bulkDays.has(daysAgo) ? 3 : between(1, 3);
        const chosen = new Set<number>();
        while (chosen.size < lineCount) chosen.add(between(0, products.length - 1));
        const lines = [...chosen].map((i) => {
          const product = products[i];
          const quantity = bulkDays.has(daysAgo) ? between(8, 14) : random() < 0.8 ? 1 : 2;
          return { product, quantity, lineTotal: product.price * quantity };
        });

        const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
        const useSummer = !bulkDays.has(daysAgo) && random() < 0.15;
        const discountAmount = useSummer ? percentOfCents(subtotal, 15) : 0;
        const status = !bulkDays.has(daysAgo) && random() < 0.06 ? 'cancelled' : 'paid';
        if (useSummer) summerUses++;

        const email = `${pick(firstNames)}.${pick(lastNames)}${between(1, 99)}@example.com`;
        const { rows } = await client.query(
          `INSERT INTO orders (customer_email, status, subtotal, discount_code, discount_amount, total, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [email, status, subtotal, useSummer ? 'SUMMER15' : null, discountAmount, subtotal - discountAmount, new Date(time)],
        );
        for (const line of lines) {
          await client.query(
            'INSERT INTO order_items (order_id, product_id, quantity, unit_price, line_total) VALUES ($1, $2, $3, $4, $5)',
            [rows[0].id, line.product.id, line.quantity, line.product.price, line.lineTotal],
          );
        }
        orderCount++;
      }
    }

    await client.query("UPDATE discount_codes SET used_count = $1 WHERE code = 'SUMMER15'", [summerUses]);
    await client.query('COMMIT');
    console.log(`Seeded ${index} products and ${orderCount} orders.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await seed();
