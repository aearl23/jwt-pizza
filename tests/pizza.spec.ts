import { test, expect } from 'playwright-test-coverage';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types mirroring src/service/pizzaService.ts
// ---------------------------------------------------------------------------

type UserRole = { role: string; objectId?: string };
type User = { id?: string; name?: string; email?: string; password?: string; roles?: UserRole[] };
type Pizza = { id: string; title: string; description: string; image: string; price: number };
type Store = { id: string; name: string; totalRevenue?: number };
type Franchise = { id: string; name: string; admins?: { name: string; email: string }[]; stores: Store[] };
type OrderItem = { menuId: string; description: string; price: number };
type Order = { id: string; franchiseId: string; storeId: string; date: string; items: OrderItem[] };
type OrderHistory = { id: string; dinerId: string; orders: Order[] };

interface MockOptions {
  user?: User | null;
  authenticated?: boolean;
  validUsers?: User[];
  orders?: Order[];
  franchise?: Franchise | null;
  franchises?: Franchise[];
  more?: boolean;
  menu?: Pizza[];
  orderError?: boolean;
  verifyError?: boolean;
  userMeError?: boolean;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const menu: Pizza[] = [
  { id: '1', title: 'Veggie', description: 'A garden of delight', image: 'pizza1.png', price: 0.0038 },
  { id: '2', title: 'Pepperoni', description: 'Spicy treat', image: 'pizza2.png', price: 0.0042 },
  { id: '3', title: 'Margarita', description: 'Essential classic', image: 'pizza3.png', price: 0.0014 },
  { id: '4', title: 'Crusty', description: 'A dry mouthed favorite', image: 'pizza4.png', price: 0.0024 },
];

const franchise: Franchise = {
  id: '2',
  name: 'LotaPizza',
  admins: [{ name: 'Kai Chen', email: 'd@jwt.com' }],
  stores: [
    { id: '4', name: 'Lehi', totalRevenue: 0.02 },
    { id: '5', name: 'Springville', totalRevenue: 0.01 },
  ],
};

const franchises: Franchise[] = [
  franchise,
  { id: '3', name: 'PizzaCorp', admins: [{ name: 'Jane Doe', email: 'j@jwt.com' }], stores: [{ id: '7', name: 'Spanish Fork', totalRevenue: 0.03 }] },
  { id: '4', name: 'topSpot', admins: [], stores: [] },
];

const diner: User = { id: '3', name: 'Kai Chen', email: 'd@jwt.com', password: 'a', roles: [{ role: 'diner' }] };
const dinerFranchisee: User = {
  id: '3',
  name: 'Kai Chen',
  email: 'd@jwt.com',
  password: 'a',
  roles: [{ role: 'diner' }, { role: 'franchisee', objectId: '2' }],
};
const franchisee: User = { id: '4', name: 'Fran Chisee', email: 'f@jwt.com', password: 'franchisee', roles: [{ role: 'franchisee', objectId: '2' }] };
const admin: User = { id: '1', name: 'Admin', email: 'a@jwt.com', password: 'admin', roles: [{ role: 'admin' }] };

const sampleOrders: Order[] = [
  { id: '23', franchiseId: '2', storeId: '4', date: '2024-01-01T00:00:00.000Z', items: [{ menuId: '1', description: 'Veggie', price: 0.0038 }, { menuId: '2', description: 'Pepperoni', price: 0.0042 }] },
  { id: '24', franchiseId: '2', storeId: '5', date: '2024-01-02T00:00:00.000Z', items: [{ menuId: '3', description: 'Margarita', price: 0.0014 }] },
];

// ---------------------------------------------------------------------------
// Mocking the JWT Pizza service
// ---------------------------------------------------------------------------

async function mockApi(page: Page, options: MockOptions) {
  // Login / register / logout
  await page.route(/\/api\/auth$/, async (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      const { email, password } = request.postDataJSON();
      const user = (options.validUsers ?? []).find((u) => u.email === email && u.password === password);
      if (!user) {
        await route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
        return;
      }
      await route.fulfill({ json: { user, token: 'abcdef' } });
      return;
    }
    if (request.method() === 'POST') {
      const { name, email } = request.postDataJSON();
      const user: User = { id: '9', name, email, roles: [{ role: 'diner' }] };
      await route.fulfill({ json: { user, token: 'abcdef' } });
      return;
    }
    await route.fulfill({ json: { message: 'logout' } });
  });

  // Currently logged in user
  await page.route(/\/api\/user\/me$/, async (route) => {
    if (options.userMeError || !options.user) {
      await route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
      return;
    }
    await route.fulfill({ json: options.user });
  });

  // Menu
  await page.route(/\/api\/order\/menu$/, async (route) => {
    await route.fulfill({ json: options.menu ?? menu });
  });

  // Verify order (JWT Pizza Factory)
  await page.route(/\/api\/order\/verify$/, async (route) => {
    if (options.verifyError) {
      await route.fulfill({ status: 500, json: { message: 'bad' } });
      return;
    }
    await route.fulfill({ json: { message: 'valid', payload: { orderId: '23' } } });
  });

  // Orders (history + purchase)
  await page.route(/\/api\/order$/, async (route) => {
    if (route.request().method() === 'POST') {
      if (options.orderError) {
        await route.fulfill({ status: 500, json: { message: 'Order failed' } });
        return;
      }
      const orderReq = route.request().postDataJSON();
      await route.fulfill({ json: { order: { ...orderReq, id: '23', date: '2024-01-01T00:00:00.000Z' }, jwt: 'eyJpYXQ' } });
      return;
    }
    const history: OrderHistory = { id: '1', dinerId: '3', orders: options.orders ?? [] };
    await route.fulfill({ json: history });
  });

  // Documentation
  await page.route(/\/api\/docs$/, async (route) => {
    const isFactory = route.request().url().includes('factory');
    await route.fulfill({
      json: {
        endpoints: [
          {
            requiresAuth: true,
            method: 'GET',
            path: isFactory ? '/api/order/verify' : '/api/order/menu',
            description: isFactory ? 'Factory endpoint documentation' : 'Service endpoint documentation',
            example: 'curl https://pizza.example/api',
            response: { ok: true },
          },
        ],
      },
    });
  });

  // Create / list franchises
  await page.route(/\/api\/franchise(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: { ...body, id: '5', stores: [] } });
      return;
    }
    await route.fulfill({ json: { franchises: options.franchises ?? franchises, more: options.more ?? false } });
  });

  // Create a store
  await page.route(/\/api\/franchise\/[^/]+\/store$/, async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { ...body, id: '10' } });
  });

  // Close a store
  await page.route(/\/api\/franchise\/[^/]+\/store\/[^/]+$/, async (route) => {
    await route.fulfill({ json: { message: 'closed' } });
  });

  // Franchise for the current user / close franchise
  await page.route(/\/api\/franchise\/[^/]+$/, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ json: { message: 'closed' } });
      return;
    }
    await route.fulfill({ json: options.franchise ? [options.franchise] : [] });
  });
}

// Starts a test with all endpoints mocked. When `authenticated` is set the test
// begins with a token in local storage (i.e. already logged in).
async function start(page: Page, options: MockOptions = {}) {
  const opts: MockOptions = { ...options };
  await mockApi(page, opts);
  if (options.authenticated) {
    await page.addInitScript(() => window.localStorage.setItem('token', 'abcdef'));
  }
  return opts;
}

// Walks the order flow up to the payment page (without paying).
async function orderPizzasUpToPayment(page: Page) {
  await page.goto('/menu');
  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('button', { name: /Veggie/ }).click();
  await page.getByRole('button', { name: /Pepperoni/ }).click();
  await expect(page.locator('form')).toContainText('Selected pizzas: 2');
  await page.getByRole('button', { name: 'Checkout' }).click();
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

test('home page', async ({ page }) => {
  await start(page);
  await page.goto('/');
  expect(await page.title()).toBe('JWT Pizza');
  await expect(page.getByRole('heading', { name: "The web's best pizza" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Order now' })).toBeVisible();
  await page.getByRole('button', { name: 'Order now' }).click();
  await expect(page.getByRole('heading', { name: 'Awesome is a click away' })).toBeVisible();
});

test('about page', async ({ page }) => {
  await start(page);
  await page.goto('/about');
  await expect(page.getByText('The secret sauce')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Our employees' })).toBeVisible();
});

test('history page', async ({ page }) => {
  await start(page);
  await page.goto('/history');
  await expect(page.getByText('Mama Rucci, my my')).toBeVisible();
});

test('not found page', async ({ page }) => {
  await start(page);
  await page.goto('/definitely-not-a-page');
  await expect(page.getByText('Oops')).toBeVisible();
  await expect(page.getByText('It looks like we have dropped a pizza on the floor')).toBeVisible();
});

test('docs page', async ({ page }) => {
  await start(page);
  await page.goto('/docs');
  await expect(page.getByText('JWT Pizza API')).toBeVisible();
  await expect(page.getByText('Service endpoint documentation')).toBeVisible();
  await expect(page.getByText('[GET] /api/order/menu')).toBeVisible();
});

test('factory docs page', async ({ page }) => {
  await start(page);
  await page.goto('/docs/factory');
  await expect(page.getByText('Factory endpoint documentation')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('login', async ({ page }) => {
  await start(page, { validUsers: [diner] });
  await page.goto('/');
  await page.getByRole('link', { name: 'Login' }).click();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
});

test('login failure', async ({ page }) => {
  await start(page, { validUsers: [diner] });
  await page.goto('/login');
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Unauthorized')).toBeVisible();
});

test('register', async ({ page }) => {
  await start(page);
  await page.goto('/register');
  await expect(page.getByText('Welcome to the party')).toBeVisible();
  await page.getByPlaceholder('Full name').fill('New Person');
  await page.getByPlaceholder('Email address').fill('new@jwt.com');
  await page.getByPlaceholder('Password').fill('secret');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('link', { name: 'NP' })).toBeVisible();
});

test('logout', async ({ page }) => {
  await start(page, { user: diner, validUsers: [diner], authenticated: true });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
  await page.getByRole('link', { name: 'Logout' }).click();
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
});

test('getUser with a bad token clears the token', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('token', 'expired'));
  await mockApi(page, { userMeError: true });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

test('purchase with login', async ({ page }) => {
  await start(page, { user: diner, validUsers: [diner] });

  await orderPizzasUpToPayment(page);

  // Login is required before paying
  await expect(page).toHaveURL(/\/payment\/login/);
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();

  // Review the order
  await expect(page.getByRole('main')).toContainText('Send me those 2 pizzas right now!');
  await expect(page.locator('tbody')).toContainText('Veggie');
  await expect(page.locator('tbody')).toContainText('Pepperoni');
  await expect(page.locator('tfoot')).toContainText('0.008 ₿');
  await page.getByRole('button', { name: 'Pay now' }).click();

  // Delivery
  await expect(page.getByRole('main')).toContainText('Here is your JWT Pizza!');
  await expect(page.getByText('order ID:')).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('#hs-jwt-modal')).toContainText('valid');
});

test('delivery handles a failed verification', async ({ page }) => {
  await start(page, { verifyError: true });
  await page.goto('/delivery');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.locator('#hs-jwt-modal')).toContainText('invalid JWT');
});

test('payment error is displayed', async ({ page }) => {
  await start(page, { user: diner, validUsers: [diner], orderError: true });

  await orderPizzasUpToPayment(page);
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText(/Order failed/)).toBeVisible();
});

test('payment can be cancelled', async ({ page }) => {
  await start(page, { user: diner, validUsers: [diner] });

  await orderPizzasUpToPayment(page);
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page).toHaveURL(/\/menu/);
  await expect(page.locator('form')).toContainText('Selected pizzas: 2');
});

// ---------------------------------------------------------------------------
// Diner dashboard
// ---------------------------------------------------------------------------

test('diner dashboard shows order history and roles', async ({ page }) => {
  await start(page, { user: dinerFranchisee, orders: sampleOrders, authenticated: true });
  await page.goto('/diner-dashboard');
  await expect(page.getByText('Your pizza kitchen')).toBeVisible();
  await expect(page.getByText('Kai Chen')).toBeVisible();
  await expect(page.getByText('Franchisee on 2')).toBeVisible();
  await expect(page.locator('tbody')).toContainText('0.008');
});

test('diner dashboard with no orders', async ({ page }) => {
  await start(page, { user: diner, orders: [], authenticated: true });
  await page.goto('/diner-dashboard');
  await expect(page.getByText('How have you lived this long without having a pizza?')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buy one' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Franchise dashboard
// ---------------------------------------------------------------------------

test('franchise dashboard and the create/close store flow', async ({ page }) => {
  await start(page, { user: franchisee, franchise, authenticated: true });

  await page.goto('/franchise-dashboard');
  await expect(page.getByRole('heading', { name: 'LotaPizza' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('Lehi');

  // Create a store
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(page.getByRole('heading', { name: 'Create store' })).toBeVisible();
  await page.getByPlaceholder('store name').fill('Provo');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/franchise-dashboard$/);

  // Close a store
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sorry to see you go' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/franchise-dashboard$/);
});

test('franchise dashboard without a franchise', async ({ page }) => {
  await start(page, { user: franchisee, franchise: null, authenticated: true });
  await page.goto('/franchise-dashboard');
  await expect(page.getByText('So you want a piece of the pie?')).toBeVisible();
  await expect(page.getByRole('link', { name: 'login' })).toBeVisible();
});

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------

test('non-admin cannot see the admin dashboard', async ({ page }) => {
  await start(page, { user: diner, authenticated: true });
  await page.goto('/admin-dashboard');
  await expect(page.getByText('Oops')).toBeVisible();
});

test('admin dashboard manages franchises', async ({ page }) => {
  await start(page, { user: admin, franchises, more: true, authenticated: true });

  await page.goto('/admin-dashboard');
  await expect(page.getByRole('heading', { name: "Mama Ricci's kitchen" })).toBeVisible();
  await expect(page.getByText('LotaPizza')).toBeVisible();
  await expect(page.getByText('Jane Doe')).toBeVisible();

  // Filter
  await page.getByPlaceholder('Filter franchises').fill('Lota');
  await page.getByRole('button', { name: 'Submit' }).click();

  // Paginate
  await page.getByRole('button', { name: '»' }).click();
  await page.getByRole('button', { name: '«' }).click();

  // Create a franchise
  await page.getByRole('button', { name: 'Add Franchise' }).click();
  await expect(page.getByRole('heading', { name: 'Create franchise' })).toBeVisible();
  await page.getByPlaceholder('franchise name').fill('My Franchise');
  await page.getByPlaceholder('franchisee admin email').fill('owner@jwt.com');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/admin-dashboard$/);

  // Close a franchise
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sorry to see you go' })).toBeVisible();
  await expect(page.getByText('LotaPizza')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/admin-dashboard$/);
});
