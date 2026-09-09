import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

type CatalogProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  line: string | null;
  isActive: boolean;
  category: { id: string; name: string; slug: string } | null;
  images: Array<{ url: string; altText: string | null }>;
  variants: Array<{
    id: string;
    sku: string;
    name: string;
    stockQuantity: number;
    availableStock: number;
    reservedQuantity: number;
    currentPrice: { amount: number; originalAmount: number; discountAmount: number; promotion: { id: string; name: string; discountType: string } | null } | null;
  }>;
};

type Category = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'CUSTOMER' | 'ADMIN' | 'SUPER_ADMIN';
};

type CartItem = {
  variantId: string;
  quantity: number;
};

type Order = {
  id: string;
  status: string;
  paymentStatus: string;
  customer: { email: string; firstName: string; lastName: string; phone: string | null };
  deliveryMethod: { id: string; name: string; cost: number } | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  subtotal: number;
  deliveryCost: number;
  total: number;
  items: Array<{ id: string; variantId: string; productName: string; variantName: string; quantity: number; unitPrice: number; lineTotal: number }>;
  payments: Array<{ id: string; amount: number; status: string; method: string | null; notes: string | null; paidAt: string | null; createdAt: string }>;
  createdAt: string;
};

type DeliveryMethod = {
  id: string;
  name: string;
  description: string | null;
  cost: number;
  requiresAddress: boolean;
  isActive: boolean;
};

type AdminUser = AuthUser & {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type Promotion = {
  id: string;
  name: string;
  scope: 'PRODUCT' | 'VARIANT' | 'CATEGORY' | 'CATALOG';
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FIXED_PRICE';
  value: number;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  productId: string | null;
  variantId: string | null;
  categoryId: string | null;
  catalogId: string | null;
};

type AccountMovement = {
  id: string;
  orderId: string | null;
  paymentId: string | null;
  actorId: string | null;
  type: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceAfter: number;
  description: string | null;
  occurredAt: string;
  createdAt: string;
};

type CustomerAccount = {
  id: string;
  customerId: string;
  currentBalance: number;
  currency: string;
  lastMovementAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminCustomerAccount = CustomerAccount & {
  customer: { id: string; email: string; firstName: string; lastName: string; phone: string | null; isActive: boolean };
  movementCount: number;
};

const PAYMENT_METHOD_OPTIONS = [
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'debito', label: 'Debito' },
  { value: 'credito', label: 'Credito' },
];

type AdminFormSubmit = (event: FormEvent<HTMLFormElement>) => void | Promise<void>;

function resolveApiUrl() {
  const configuredUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

  if (typeof window === 'undefined') {
    return configuredUrl;
  }

  const url = new URL(configuredUrl);
  const isLocalApiHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const isLocalWebHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  if (isLocalApiHost && !isLocalWebHost) {
    url.hostname = window.location.hostname;
  }

  return url.toString().replace(/\/$/, '');
}

const apiUrl = resolveApiUrl();
const promoSlides = [
  { title: 'Promos de catalogo', text: 'Seleccion de productos con precios actualizados y stock administrado.' },
  { title: 'Pedidos registrados', text: 'Armá tu carrito, iniciá sesión y confirmá tu pedido online.' },
  { title: 'Entrega coordinada', text: 'Retiro, envio local o correo segun disponibilidad.' },
];

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

function isAdmin(user: AuthUser | null) {
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: isFormData ? options.headers : { 'Content-Type': 'application/json', ...options.headers },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(error?.error?.message ?? 'Error de API', response.status, error?.error?.code);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function isExpiredSessionError(error: unknown) {
  return error instanceof ApiError && error.status === 401 && (error.code === 'INVALID_TOKEN' || error.code === 'AUTH_REQUIRED');
}

function isSessionExpiredRedirect(error: unknown) {
  return error instanceof ApiError && error.code === 'SESSION_EXPIRED';
}

function authErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.code === 'EMAIL_ALREADY_REGISTERED') {
    return 'Ese email ya esta registrado. Inicia sesion o pedi un nuevo enlace de validacion.';
  }

  if (error instanceof ApiError && error.code === 'EMAIL_VERIFICATION_REQUIRED') {
    return 'Necesitas validar tu email antes de iniciar sesion. Revisa tu correo o pedi un nuevo enlace.';
  }

  if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
    return 'Email o contrasena incorrectos.';
  }

  if (error instanceof ApiError && error.status === 429) {
    return 'Hubo demasiados intentos. Espera unos minutos y volve a probar.';
  }

  return error instanceof Error ? error.message : fallback;
}

function imageSource(url: string) {
  return url.startsWith('http') ? url : `${apiUrl}${url}`;
}

function formatPrice(amount: number) {
  return amount.toLocaleString('es-AR', { currency: 'ARS', maximumFractionDigits: 0, style: 'currency' });
}

function accountMovementLabel(type: string) {
  if (type === 'ORDER_CHARGE') return 'Cargo por pedido';
  if (type === 'ORDER_CANCEL_CREDIT') return 'Crédito por cancelación';
  if (type === 'PAYMENT_CREDIT') return 'Pago registrado';
  if (type === 'PAYMENT_REFUND_DEBIT') return 'Reembolso';
  if (type === 'MANUAL_DEBIT_ADJUSTMENT') return 'Ajuste débito';
  if (type === 'MANUAL_CREDIT_ADJUSTMENT') return 'Ajuste crédito';
  return type;
}

function balanceText(balance: number) {
  if (balance > 0) return `Debe ${formatPrice(balance)}`;
  if (balance < 0) return `Saldo a favor ${formatPrice(Math.abs(balance))}`;
  return 'Sin deuda';
}

function productVariant(product: CatalogProduct) {
  return product.variants[0] ?? null;
}

function handleModalKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === 'Escape') {
    onClose();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function Nav({ cartCount, user, navigate, path }: { cartCount: number; user: AuthUser | null; navigate: (path: string) => void; path: string }) {
  const links = [
    ['/', 'Home'],
    ['/productos', 'Productos'],
    ['/carrito', `Carrito (${cartCount})`],
    ...(user ? [['/mis-pedidos', 'Mis pedidos']] : []),
    ...(user?.role === 'CUSTOMER' ? [['/cuenta-corriente', 'Cuenta corriente']] : []),
    ...(isAdmin(user) ? [['/admin', 'Admin']] : []),
    [user ? '/cuenta' : '/login', user ? user.firstName : 'Ingresar'],
  ];

  return (
    <nav className="nav" aria-label="Principal">
      <button className="brand" type="button" onClick={() => navigate('/')}>Natura reseller</button>
      <div className="navLinks">
        {links.map(([href, label]) => (
          <button className={path === href || (href === '/admin' && path.startsWith('/admin')) ? 'active' : ''} key={href} type="button" onClick={() => navigate(href)}>{label}</button>
        ))}
      </div>
    </nav>
  );
}

function ProductCard({ product, onAdd }: { product: CatalogProduct; onAdd: (product: CatalogProduct) => void }) {
  const variant = productVariant(product);
  const image = product.images[0];

  return (
    <article className="productCard">
      <div className="productImage">
        {image ? <img src={imageSource(image.url)} alt={image.altText ?? product.name} loading="lazy" /> : <span>Sin imagen</span>}
      </div>
      <div className="productInfo">
        <span>{product.category?.name ?? product.line ?? 'Producto'}</span>
        <h3>{product.name}</h3>
        <p>{product.description || 'Producto disponible para el catalogo.'}</p>
        <div className="productMeta">
          <strong>{variant?.currentPrice ? formatPrice(variant.currentPrice.amount) : 'Sin precio'}</strong>
          <small>{variant ? `Disponible: ${variant.availableStock}` : 'Sin variantes'}</small>
        </div>
        {variant?.currentPrice?.promotion ? <small className="promoBadge">{variant.currentPrice.promotion.name} · antes {formatPrice(variant.currentPrice.originalAmount)}</small> : null}
        <button disabled={!variant || !variant.currentPrice || variant.availableStock < 1} type="button" onClick={() => onAdd(product)}>
          Agregar al carrito
        </button>
      </div>
    </article>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div>
        <strong>Natura reseller</strong>
        <p>Catalogo de revendedora independiente. No es tienda oficial Natura.</p>
      </div>
      <div>
        <strong>Contacto</strong>
        <p>Consultas, pedidos y entregas coordinadas por mensaje.</p>
      </div>
      <div>
        <strong>Redes</strong>
        <a href="https://instagram.com/" rel="noreferrer" target="_blank">Instagram</a>
      </div>
    </footer>
  );
}

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [adminProducts, setAdminProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<DeliveryMethod[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [accountMovements, setAccountMovements] = useState<AccountMovement[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminAccounts, setAdminAccounts] = useState<AdminCustomerAccount[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [cart, setCart] = useState<CartItem[]>(() => JSON.parse(localStorage.getItem('cart') ?? '[]') as CartItem[]);
  const [isLoading, setIsLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [token, setToken] = useState(() => localStorage.getItem('accessToken') ?? '');
  const [user, setUser] = useState<AuthUser | null>(() => JSON.parse(localStorage.getItem('user') ?? 'null') as AuthUser | null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState(null, '', nextPath);
    setPath(nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    setToken('');
    setUser(null);
    setOrders([]);
    setAccount(null);
    setAccountMovements([]);
    setAdminProducts([]);
    setAdminUsers([]);
    setAdminAccounts([]);
    setPromotions([]);
  }, []);

  const expireSession = useCallback(() => {
    clearSession();
    setError(null);
    setMessage('Tu sesion expiro. Volve a iniciar sesion para continuar.');
    navigate('/login');
  }, [clearSession, navigate]);

  const authenticatedRequest = useCallback(async <T,>(requestPath: string, options: RequestInit = {}) => {
    try {
      return await apiRequest<T>(requestPath, options);
    } catch (requestError) {
      if (isExpiredSessionError(requestError)) {
        expireSession();
        throw new ApiError('Tu sesion expiro. Volve a iniciar sesion para continuar.', 401, 'SESSION_EXPIRED');
      }
      throw requestError;
    }
  }, [expireSession]);

  async function loadCatalog() {
    setIsLoading(true);
    setCatalogError(null);

    try {
      const [productsData, categoriesData, deliveryMethodsData] = await Promise.all([
        apiRequest<{ products: CatalogProduct[] }>('/api/catalog/products'),
        apiRequest<{ categories: Category[] }>('/api/catalog/categories'),
        apiRequest<{ deliveryMethods: DeliveryMethod[] }>('/api/catalog/delivery-methods'),
      ]);
      setProducts(productsData.products);
      setCategories(categoriesData.categories);
      setDeliveryMethods(deliveryMethodsData.deliveryMethods);
    } catch (requestError) {
      setCatalogError(requestError instanceof Error ? requestError.message : 'Error inesperado');
    } finally {
      setIsLoading(false);
    }
  }

  const loadOrders = useCallback(async (accessToken = token) => {
    if (!accessToken) return;
    const data = await authenticatedRequest<{ orders: Order[] }>('/api/orders', { headers: { Authorization: `Bearer ${accessToken}` } });
    setOrders(data.orders);
  }, [authenticatedRequest, token]);

  const loadAccount = useCallback(async (accessToken = token) => {
    if (!accessToken || user?.role !== 'CUSTOMER') return;
    const data = await authenticatedRequest<{ account: CustomerAccount; movements: AccountMovement[] }>('/api/account/me', { headers: { Authorization: `Bearer ${accessToken}` } });
    setAccount(data.account);
    setAccountMovements(data.movements);
  }, [authenticatedRequest, token, user]);

  const loadAdminData = useCallback(async (accessToken = token) => {
    if (!accessToken || !isAdmin(user)) return;
    const [adminProductsData, adminOrdersData, adminUsersData, deliveryMethodsData, promotionsData, adminAccountsData] = await Promise.all([
      authenticatedRequest<{ products: CatalogProduct[] }>('/api/admin/products', { headers: { Authorization: `Bearer ${accessToken}` } }),
      authenticatedRequest<{ orders: Order[] }>('/api/admin/orders', { headers: { Authorization: `Bearer ${accessToken}` } }),
      authenticatedRequest<{ users: AdminUser[] }>('/api/admin/users', { headers: { Authorization: `Bearer ${accessToken}` } }),
      authenticatedRequest<{ deliveryMethods: DeliveryMethod[] }>('/api/admin/delivery-methods', { headers: { Authorization: `Bearer ${accessToken}` } }),
      authenticatedRequest<{ promotions: Promotion[] }>('/api/admin/promotions', { headers: { Authorization: `Bearer ${accessToken}` } }),
      authenticatedRequest<{ accounts: AdminCustomerAccount[] }>('/api/admin/customer-accounts', { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);
    setAdminProducts(adminProductsData.products);
    setOrders(adminOrdersData.orders);
    setAdminUsers(adminUsersData.users);
    setDeliveryMethods(deliveryMethodsData.deliveryMethods);
    setPromotions(promotionsData.promotions);
    setAdminAccounts(adminAccountsData.accounts);
  }, [authenticatedRequest, token, user]);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    void loadCatalog();
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!token) return;
    void loadOrders(token).catch(() => undefined);
    void loadAccount(token).catch(() => undefined);
  }, [loadAccount, loadOrders, token]);

  useEffect(() => {
    if (!token || !isAdmin(user)) return;
    void loadAdminData(token).catch(() => undefined);
  }, [loadAdminData, token, user]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => setMessage(null), 1000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const cartProducts = cart
    .map((item) => {
      const product = products.find((candidate) => candidate.variants.some((variant) => variant.id === item.variantId));
      const variant = product?.variants.find((candidate) => candidate.id === item.variantId) ?? null;
      return product && variant ? { product, variant, quantity: item.quantity } : null;
    })
    .filter((item): item is { product: CatalogProduct; variant: CatalogProduct['variants'][number]; quantity: number } => Boolean(item));
  const cartTotal = cartProducts.reduce((total, item) => total + (item.variant.currentPrice?.amount ?? 0) * item.quantity, 0);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const selectedProduct = adminProducts.find((product) => product.id === selectedProductId) ?? null;
  const featuredProducts = [...products].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 5);

  function addToCart(product: CatalogProduct) {
    const variant = productVariant(product);
    if (!variant || variant.availableStock < 1) return;
    setCart((current) => {
      const existing = current.find((item) => item.variantId === variant.id);
      if (existing) {
        if (existing.quantity >= variant.availableStock) return current;
        return current.map((item) => (item.variantId === variant.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { variantId: variant.id, quantity: 1 }];
    });
    setMessage(`${product.name} agregado al carrito`);
  }

  function updateCartQuantity(variantId: string, quantity: number) {
    if (quantity < 1) {
      setCart((current) => current.filter((item) => item.variantId !== variantId));
      return;
    }
    const product = products.find((candidate) => candidate.variants.some((variant) => variant.id === variantId));
    const availableStock = product?.variants.find((variant) => variant.id === variantId)?.availableStock ?? quantity;
    setCart((current) => current.map((item) => (item.variantId === variantId ? { ...item, quantity: Math.min(quantity, availableStock) } : item)));
  }

  const storeSession = useCallback((accessToken: string, authUser: AuthUser) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('user', JSON.stringify(authUser));
    setToken(accessToken);
    setUser(authUser);
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const data = await apiRequest<{ accessToken: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      storeSession(data.accessToken, data.user);
      setMessage(`Sesion iniciada como ${data.user.firstName}`);
      navigate(isAdmin(data.user) ? '/admin/productos' : '/productos');
    } catch (requestError) {
      setError(authErrorMessage(requestError, 'No se pudo iniciar sesion'));
    }
  }

  const handleVerifyEmail = useCallback(async (verificationToken: string) => {
    setError(null);
    setMessage(null);

    try {
      const data = await apiRequest<{ accessToken: string; user: AuthUser }>('/api/auth/verify-email', {
        method: 'POST',
        body: JSON.stringify({ token: verificationToken }),
      });
      storeSession(data.accessToken, data.user);
      setMessage('Email verificado. Ya podes confirmar pedidos.');
      navigate('/productos');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo verificar el email');
    }
  }, [navigate, storeSession]);

  async function handleResendVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const data = await apiRequest<{ message: string }>('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email') }),
      });
      setMessage(data.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo reenviar el enlace');
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');

    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden');
      return;
    }

    try {
      const data = await apiRequest<{ emailVerificationRequired: boolean; message: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          firstName: form.get('firstName'),
          lastName: form.get('lastName'),
          email: form.get('email'),
          phone: form.get('phone'),
          password,
        }),
      });
      setMessage(data.message || 'Registro creado. Te enviamos un email para validar la cuenta antes de iniciar sesion.');
      navigate('/login');
    } catch (requestError) {
      setError(authErrorMessage(requestError, 'No se pudo crear el usuario'));
    }
  }

  async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearSession();
    navigate('/');
  }

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!token) {
      navigate('/login');
      return;
    }

    const form = new FormData(event.currentTarget);
    const deliveryType = deliveryMethods.find((method) => method.id === form.get('deliveryMethodId'))?.name ?? 'Coordinar entrega';

    try {
      await authenticatedRequest<{ order: Order }>('/api/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
          deliveryMethodId: form.get('deliveryMethodId') || undefined,
          deliveryAddress: form.get('deliveryAddress') || undefined,
          deliveryNotes: String(form.get('deliveryNotes') ?? '').trim() || deliveryType,
        }),
      });
      setCart([]);
      setMessage('Pedido creado. La administradora lo va a revisar y confirmar.');
      await loadOrders();
      await loadAccount();
      navigate('/mis-pedidos');
    } catch (requestError) {
      if (isSessionExpiredRedirect(requestError)) return;
      setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el pedido');
    }
  }

  async function cancelOrder(id: string) {
    if (!token) return;
    setError(null);
    setMessage(null);

    try {
      await authenticatedRequest(`/api/orders/${id}/cancel`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      setMessage('Pedido cancelado. La reserva de stock fue liberada.');
      await loadCatalog();
      await loadOrders();
      await loadAccount();
    } catch (requestError) {
      if (isSessionExpiredRedirect(requestError)) return;
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cancelar el pedido');
    }
  }

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('categoryName') ?? '');
    await authenticatedRequest('/api/admin/categories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, slug: String(form.get('categorySlug') || slugify(name)) }),
    });
    event.currentTarget.reset();
    await loadCatalog();
    await loadAdminData();
    await loadAccount();
  }

  async function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('productName') ?? '');
    const image = form.get('image');
    const body = new FormData();
    body.append('categoryId', String(form.get('categoryId') ?? ''));
    body.append('name', name);
    body.append('slug', String(form.get('productSlug') || slugify(name)));
    body.append('description', String(form.get('description') ?? ''));
    body.append('line', String(form.get('line') ?? ''));
    body.append('sku', String(form.get('sku') ?? ''));
    body.append('variantName', String(form.get('variantName') ?? 'Unidad'));
    body.append('stockQuantity', String(form.get('stockQuantity') ?? 0));
    body.append('price', String(form.get('price') ?? 0));
    if (image instanceof File && image.size > 0) body.append('image', image);
    await authenticatedRequest('/api/admin/products', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
    event.currentTarget.reset();
    setMessage('Producto creado');
    await loadCatalog();
    await loadAdminData();
    await loadAccount();
  }

  async function handleUpdateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const image = form.get('editImage');
    const body = new FormData();
    body.append('categoryId', String(form.get('editCategoryId') ?? ''));
    body.append('name', String(form.get('editProductName') ?? ''));
    body.append('slug', String(form.get('editProductSlug') ?? ''));
    body.append('description', String(form.get('editDescription') ?? ''));
    body.append('line', String(form.get('editLine') ?? ''));
    body.append('isActive', String(form.get('editIsActive') === 'on'));
    body.append('sku', String(form.get('editSku') ?? ''));
    body.append('variantName', String(form.get('editVariantName') ?? 'Unidad'));
    body.append('stockQuantity', String(form.get('editStockQuantity') ?? 0));
    body.append('price', String(form.get('editPrice') ?? 0));
    if (image instanceof File && image.size > 0) body.append('image', image);
    await authenticatedRequest(`/api/admin/products/${form.get('editProductId')}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body });
    setMessage('Producto actualizado');
    await loadCatalog();
    await loadAdminData();
  }

  async function createAccountAdjustment(customerId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await authenticatedRequest(`/api/admin/customer-accounts/${customerId}/adjustments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        direction: form.get('direction'),
        amount: Number(form.get('amount') ?? 0),
        description: form.get('description'),
      }),
    });
    event.currentTarget.reset();
    setMessage('Ajuste de cuenta corriente registrado');
    await loadAdminData();
    await loadAccount();
  }

  async function updateAdminOrder(id: string, status: string, paymentStatus: string) {
    await authenticatedRequest(`/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status, paymentStatus }),
    });
    await loadAdminData();
    await loadAccount();
  }

  async function updateAdminOrderDetails(id: string, payload: { deliveryMethodId: string | null; deliveryAddress: string | null; deliveryNotes: string | null; items: Array<{ variantId: string; quantity: number }> }) {
    await authenticatedRequest(`/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    await loadCatalog();
    await loadAdminData();
    await loadAccount();
  }

  async function updateAdminUser(id: string, isActive: boolean, password?: string) {
    await authenticatedRequest(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isActive, password: password || undefined }),
    });
    await loadAdminData();
  }

  async function upsertDeliveryMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get('deliveryMethodId') ?? '');
    await authenticatedRequest(`/api/admin/delivery-methods${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: form.get('deliveryName'),
        description: form.get('deliveryDescription') || undefined,
        cost: Number(form.get('deliveryCost') ?? 0),
        requiresAddress: form.get('deliveryRequiresAddress') === 'on',
        isActive: form.get('deliveryIsActive') === 'on',
      }),
    });
    event.currentTarget.reset();
    await loadCatalog();
    await loadAdminData();
  }

  async function registerOrderPayment(id: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await authenticatedRequest(`/api/admin/orders/${id}/payments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        amount: Number(form.get('amount') ?? 0),
        method: form.get('method') || undefined,
        notes: form.get('notes') || undefined,
      }),
    });
    event.currentTarget.reset();
    await loadAdminData();
    await loadAccount();
  }

  async function upsertPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get('promotionId') ?? '');
    const scope = String(form.get('scope')) as Promotion['scope'];
    const targetId = String(form.get('targetId') ?? '');

    await authenticatedRequest(`/api/admin/promotions${id ? `/${id}` : ''}`, {
      method: id ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: form.get('name'),
        scope,
        discountType: form.get('discountType'),
        value: Number(form.get('value') ?? 0),
        priority: Number(form.get('priority') ?? 0),
        startsAt: form.get('startsAt') || null,
        endsAt: form.get('endsAt') || null,
        isActive: form.get('isActive') === 'on',
        productId: scope === 'PRODUCT' ? targetId : null,
        variantId: scope === 'VARIANT' ? targetId : null,
        categoryId: scope === 'CATEGORY' ? targetId : null,
        catalogId: null,
      }),
    });

    event.currentTarget.reset();
    await loadCatalog();
    await loadAdminData();
  }

  function renderPage() {
    if (path === '/productos') return <ProductsPage isLoading={isLoading} catalogError={catalogError} products={products} onAdd={addToCart} />;
    if (path === '/login') return <LoginPage error={error} onLogin={handleLogin} onResendVerification={handleResendVerification} navigate={navigate} />;
    if (path === '/registro') return <RegisterPage error={error} onRegister={handleRegister} navigate={navigate} />;
    if (path === '/verificar-email') return <VerifyEmailPage error={error} onVerify={handleVerifyEmail} navigate={navigate} />;
    if (path === '/carrito') return <CartPage cartProducts={cartProducts} deliveryMethods={deliveryMethods} total={cartTotal} user={user} navigate={navigate} onQuantity={updateCartQuantity} onCreateOrder={handleCreateOrder} error={error} />;
    if (path === '/mis-pedidos') return <OrdersPage orders={orders} user={user} navigate={navigate} onCancelOrder={cancelOrder} error={error} />;
    if (path === '/cuenta-corriente') return <CustomerAccountPage user={user} account={account} movements={accountMovements} navigate={navigate} />;
    if (path === '/cuenta') return <AccountPage user={user} onLogout={logout} navigate={navigate} />;
    if (path.startsWith('/admin')) return <AdminPage user={user} navigate={navigate} path={path} products={adminProducts} categories={categories} deliveryMethods={deliveryMethods} orders={orders} users={adminUsers} accounts={adminAccounts} promotions={promotions} selectedProduct={selectedProduct} selectedProductId={selectedProductId} setSelectedProductId={setSelectedProductId} onCreateCategory={handleCreateCategory} onCreateProduct={handleCreateProduct} onUpdateProduct={handleUpdateProduct} onUpdateOrder={updateAdminOrder} onUpdateOrderDetails={updateAdminOrderDetails} onUpdateUser={updateAdminUser} onUpsertDeliveryMethod={upsertDeliveryMethod} onRegisterPayment={registerOrderPayment} onCreateAccountAdjustment={createAccountAdjustment} onUpsertPromotion={upsertPromotion} />;
    return <HomePage products={featuredProducts} onAdd={addToCart} navigate={navigate} />;
  }

  return (
    <main>
      <Nav cartCount={cartCount} user={user} navigate={navigate} path={path} />
      {error ? <AppAlert message={error} variant="error" onDismiss={() => setError(null)} /> : message ? <AppAlert message={message} variant="success" onDismiss={() => setMessage(null)} /> : null}
      {renderPage()}
      <Footer />
    </main>
  );
}

function AppAlert({ message, variant, onDismiss }: { message: string; variant: 'error' | 'success'; onDismiss: () => void }) {
  return <div className="appAlertBackdrop"><div className={`appAlert ${variant === 'error' ? 'appAlertError' : 'appAlertSuccess'}`} role={variant === 'error' ? 'alert' : 'status'} aria-live={variant === 'error' ? 'assertive' : 'polite'}><span>{message}</span><button className="appAlertClose" type="button" onClick={onDismiss} aria-label="Cerrar alerta">×</button></div></div>;
}

function HomePage({ products, onAdd, navigate }: { products: CatalogProduct[]; onAdd: (product: CatalogProduct) => void; navigate: (path: string) => void }) {
  return (
    <>
      <header className="hero">
        <section className="heroGrid">
          <div className="heroCopy">
            <p className="eyebrow">Catalogo Natura por revendedora</p>
            <h1>Productos para cuidar tu rutina de todos los dias.</h1>
            <p className="lead">Comprá productos de belleza, perfumeria y cuidado personal con registro, carrito y pedidos coordinados.</p>
            <div className="actions">
              <button className="primary" type="button" onClick={() => navigate('/productos')}>Ver productos</button>
              <button className="secondary" type="button" onClick={() => navigate('/registro')}>Registrarme</button>
            </div>
          </div>
          <aside className="promoSlider" aria-label="Promociones destacadas">
            {promoSlides.map((slide, index) => (
              <article className="promoCard" key={slide.title}>
                <span>Destacado {index + 1}</span>
                <h2>{slide.title}</h2>
                <p>{slide.text}</p>
              </article>
            ))}
          </aside>
        </section>
      </header>

      <section className="section aboutSection">
        <div>
          <p className="eyebrow">De que se trata</p>
          <h2>Una forma simple de pedir Natura online.</h2>
        </div>
        <div className="aboutContent">
          <p>Este catalogo pertenece a una revendedora independiente. Reune productos disponibles, precios actualizados y pedidos registrados para coordinar preparacion, pago y entrega.</p>
        </div>
      </section>

      <section className="section">
        <div className="moduleGrid">
          <article className="module imageModule"><span>Pedido</span><h3>Registrate y pedí</h3><p>Creá tu cuenta para confirmar pedidos y consultar el estado desde la web.</p></article>
          <article className="module"><span>Envios</span><h3>Opciones flexibles</h3><p>Retiro, envio local o correo. La opcion final se coordina al confirmar el pedido.</p></article>
          <article className="module"><span>Admin</span><h3>Gestion centralizada</h3><p>La administradora recibe pedidos, actualiza estados y gestiona productos y clientes.</p></article>
        </div>
      </section>

      <section className="section featuredProducts">
        <div className="sectionHeader">
          <div><p className="eyebrow">Productos destacados</p><h2>Favoritos para sumar al pedido.</h2></div>
          <button className="textLink" type="button" onClick={() => navigate('/productos')}>Ver todos</button>
        </div>
        <div className="productGrid">{products.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>
      </section>
    </>
  );
}

function ProductsPage({ isLoading, catalogError, products, onAdd }: { isLoading: boolean; catalogError: string | null; products: CatalogProduct[]; onAdd: (product: CatalogProduct) => void }) {
  const [search, setSearch] = useState('');
  const normalized = search.trim().toLowerCase();
  const filtered = normalized
    ? products.filter((product) => [product.name, product.description, product.line, product.category?.name].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
    : products;

  return (
    <section className="section pageSection">
      <div className="sectionHeader"><div><p className="eyebrow">Catalogo</p><h1>Todos los productos.</h1></div></div>
      <input className="searchInput" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por producto, categoria o linea" />
      {isLoading ? <p className="statusText">Cargando productos...</p> : null}
      {catalogError ? <p className="statusText errorText">{catalogError}</p> : null}
      {!isLoading && !catalogError && filtered.length === 0 ? <p className="statusText">No encontramos productos para esa busqueda.</p> : null}
      <div className="productGrid">{filtered.map((product) => <ProductCard key={product.id} product={product} onAdd={onAdd} />)}</div>
    </section>
  );
}

function LoginPage({ error, onLogin, onResendVerification, navigate }: { error: string | null; onLogin: (event: FormEvent<HTMLFormElement>) => void; onResendVerification: (event: FormEvent<HTMLFormElement>) => void; navigate: (path: string) => void }) {
  return <AuthShell title="Iniciar sesion" error={error}><form className="adminForm compactForm" onSubmit={onLogin}><label>Email<input name="email" type="email" required /></label><label>Contrasena<input name="password" type="password" required /></label><button type="submit">Ingresar</button><button className="secondaryButton" type="button" onClick={() => navigate('/registro')}>Crear cuenta cliente</button></form><form className="adminForm compactForm" onSubmit={onResendVerification}><p className="statusText">Si todavia no validaste tu email, pedi un nuevo enlace.</p><label>Email<input name="email" type="email" required /></label><button className="secondaryButton" type="submit">Reenviar validacion</button></form></AuthShell>;
}

function RegisterPage({ error, onRegister, navigate }: { error: string | null; onRegister: (event: FormEvent<HTMLFormElement>) => void; navigate: (path: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const hasConfirmPassword = confirmPassword.length > 0;
  const passwordsMatch = password === confirmPassword;
  const showMismatch = hasConfirmPassword && !passwordsMatch;

  return <AuthShell title="Registro de cliente" error={error}><form className="adminForm compactForm" onSubmit={onRegister}><div className="formRow"><label>Nombre<input name="firstName" required /></label><label>Apellido<input name="lastName" required /></label></div><label>Email<input name="email" type="email" required /></label><label>Telefono<input name="phone" /></label><div className="formRow"><label>Contrasena<div className="passwordInputGroup"><input name="password" type={showPassword ? 'text' : 'password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><button className="passwordToggleButton" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}>{showPassword ? '🙈' : '👁️'}</button></div><small>Minimo 8 caracteres.</small></label><label>Repetir contrasena<div className="passwordInputGroup"><input name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" aria-invalid={showMismatch} aria-describedby="passwordMatchHelp" /><button className="passwordToggleButton" type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? 'Ocultar repeticion de contrasena' : 'Mostrar repeticion de contrasena'}>{showConfirmPassword ? '🙈' : '👁️'}</button></div><small id="passwordMatchHelp" className={showMismatch ? 'passwordMismatchText' : hasConfirmPassword ? 'passwordMatchText' : undefined}>{showMismatch ? 'Las contrasenas no coinciden.' : hasConfirmPassword ? 'Las contrasenas coinciden.' : 'Volvela a escribir para comparar.'}</small></label></div><button type="submit" disabled={showMismatch}>Registrarme</button><button className="secondaryButton" type="button" onClick={() => navigate('/login')}>Ya tengo cuenta</button></form></AuthShell>;
}

function VerifyEmailPage({ error, onVerify, navigate }: { error: string | null; onVerify: (token: string) => void; navigate: (path: string) => void }) {
  const [started, setStarted] = useState(false);
  const token = new URLSearchParams(window.location.search).get('token') ?? '';

  useEffect(() => {
    if (!started && token) {
      setStarted(true);
      onVerify(token);
    }
  }, [onVerify, started, token]);

  if (!token) {
    return <AuthShell title="Validar email" error={error}><p className="statusText errorText">El enlace de validacion no tiene token.</p><button className="secondaryButton" type="button" onClick={() => navigate('/login')}>Volver al login</button></AuthShell>;
  }

  return <AuthShell title="Validar email" error={error}><p className="statusText">Estamos validando tu email...</p><button className="secondaryButton" type="button" onClick={() => navigate('/login')}>Volver al login</button></AuthShell>;
}

function AuthShell({ title, error, children }: { title: string; error: string | null; children: React.ReactNode }) {
  return <section className="section authSection"><p className="eyebrow">Cuenta</p><h1>{title}</h1>{error ? <p className="statusText errorText">{error}</p> : null}{children}</section>;
}

function CartPage({ cartProducts, deliveryMethods, total, user, navigate, onQuantity, onCreateOrder, error }: { cartProducts: Array<{ product: CatalogProduct; variant: CatalogProduct['variants'][number]; quantity: number }>; deliveryMethods: DeliveryMethod[]; total: number; user: AuthUser | null; navigate: (path: string) => void; onQuantity: (variantId: string, quantity: number) => void; onCreateOrder: (event: FormEvent<HTMLFormElement>) => void; error: string | null }) {
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const selectedDeliveryMethod = deliveryMethods.find((method) => method.id === deliveryMethodId) ?? null;
  const orderTotal = total + (selectedDeliveryMethod?.cost ?? 0);

  return (
    <section className="section pageSection cartPage">
      <div className="sectionHeader cartHeader">
        <div>
          <p className="eyebrow">Carrito</p>
          <h1>Tu pedido.</h1>
        </div>
        {cartProducts.length > 0 ? <p className="cartHeaderSummary">{cartProducts.length} producto{cartProducts.length === 1 ? '' : 's'} · {formatPrice(total)}</p> : null}
      </div>
      {error ? <p className="statusText errorText">{error}</p> : null}
      {cartProducts.length === 0 ? <p className="statusText">El carrito esta vacio.</p> : (
        <div className="cartLayout">
          <div className="cartList">
            {cartProducts.map(({ product, variant, quantity }) => (
              <article className="cartItem" key={variant.id}>
                <div className="cartItemInfo">
                  <strong>{product.name}</strong>
                </div>
                <span className="cartItemUnit">{variant.name}</span>
                <strong className="cartItemPrice">{formatPrice((variant.currentPrice?.amount ?? 0) * quantity)}</strong>
                <label className="cartQuantity">
                  <span>Cantidad</span>
                  <input max={variant.availableStock} min="1" type="number" value={quantity} onChange={(event) => onQuantity(variant.id, Number(event.target.value))} />
                </label>
                <button className="cartRemoveButton" type="button" onClick={() => onQuantity(variant.id, 0)}>Quitar</button>
              </article>
            ))}
          </div>
          <form className="adminForm checkoutForm" onSubmit={onCreateOrder}>
            <div className="checkoutTotal"><span>Total</span><strong>{formatPrice(orderTotal)}</strong></div>
            <label>Tipo de entrega<select name="deliveryMethodId" value={deliveryMethodId} onChange={(event) => setDeliveryMethodId(event.target.value)}><option value="">Coordinar entrega</option>{deliveryMethods.map((method) => <option key={method.id} value={method.id}>{method.name} · {formatPrice(method.cost)}</option>)}</select></label>
            {selectedDeliveryMethod?.description ? <p className="statusText compactStatus">{selectedDeliveryMethod.description}</p> : null}
            <label>Direccion si corresponde<textarea name="deliveryAddress" rows={2} required={Boolean(selectedDeliveryMethod?.requiresAddress)} /></label>
            <label>Notas<textarea name="deliveryNotes" rows={2} /></label>
            {!user ? <p className="statusText compactStatus">Para confirmar tenes que iniciar sesion o registrarte.</p> : null}
            <div className="checkoutActions">
              <button type="submit">{user ? 'Confirmar pedido' : 'Iniciar sesion para confirmar'}</button>
              <button className="secondaryButton" type="button" onClick={() => navigate('/productos')}>Seguir comprando</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function OrdersPage({ orders, user, navigate, onCancelOrder, error }: { orders: Order[]; user: AuthUser | null; navigate: (path: string) => void; onCancelOrder: (id: string) => void; error: string | null }) {
  if (!user) return <section className="section"><p className="statusText">Inicia sesion para ver tus pedidos.</p><button className="primary" type="button" onClick={() => navigate('/login')}>Ingresar</button></section>;
  return <section className="section pageSection"><p className="eyebrow">Historial</p><h1>Mis pedidos.</h1>{error ? <p className="statusText errorText">{error}</p> : null}{orders.length === 0 ? <p className="statusText">Todavia no tenes pedidos.</p> : <OrderList orders={orders} onCancelOrder={onCancelOrder} />}</section>;
}

function AccountPage({ user, onLogout, navigate }: { user: AuthUser | null; onLogout: () => void; navigate: (path: string) => void }) {
  if (!user) return <section className="section"><p className="statusText">No hay sesion activa.</p><button className="primary" type="button" onClick={() => navigate('/login')}>Ingresar</button></section>;
  return <section className="section authSection"><p className="eyebrow">Cuenta</p><h1>{user.firstName} {user.lastName}</h1><p className="statusText">{user.email} · {user.role}</p><button className="primary" type="button" onClick={onLogout}>Cerrar sesion</button></section>;
}

function CustomerAccountPage({ user, account, movements, navigate }: { user: AuthUser | null; account: CustomerAccount | null; movements: AccountMovement[]; navigate: (path: string) => void }) {
  if (!user) return <section className="section"><p className="statusText">Inicia sesion para ver tu cuenta corriente.</p><button className="primary" type="button" onClick={() => navigate('/login')}>Ingresar</button></section>;
  if (user.role !== 'CUSTOMER') return <section className="section"><p className="statusText errorText">La cuenta corriente publica esta disponible solo para clientes.</p><button className="primary" type="button" onClick={() => navigate('/admin/cuentas')}>Ver cuentas admin</button></section>;

  return (
    <section className="section pageSection accountPage">
      <div className="sectionHeader">
        <div><p className="eyebrow">Cuenta corriente</p><h1>Saldo y movimientos.</h1><p className="statusText">Aca vas a ver cargos de pedidos, pagos registrados y ajustes de tu cuenta.</p></div>
        <div className={`balanceCard ${(account?.currentBalance ?? 0) > 0 ? 'debt' : 'ok'}`}><span>Saldo actual</span><strong>{balanceText(account?.currentBalance ?? 0)}</strong></div>
      </div>
      <AccountMovementList movements={movements} emptyText="Todavia no hay movimientos en tu cuenta corriente." />
    </section>
  );
}

function AccountMovementList({ movements, emptyText }: { movements: AccountMovement[]; emptyText: string }) {
  if (movements.length === 0) return <p className="statusText">{emptyText}</p>;

  return (
    <div className="accountMovementList">
      {movements.map((movement) => (
        <article className="accountMovementRow" key={movement.id}>
          <div><strong>{accountMovementLabel(movement.type)}</strong><small>{movement.description || 'Movimiento de cuenta'}{movement.orderId ? ` · Pedido ${movement.orderId.slice(0, 8)}` : ''}</small></div>
          <span className={movement.direction === 'DEBIT' ? 'debitAmount' : 'creditAmount'}>{movement.direction === 'DEBIT' ? '+' : '-'} {formatPrice(movement.amount)}</span>
          <span>{balanceText(movement.balanceAfter)}</span>
          <small>{new Date(movement.occurredAt).toLocaleString('es-AR')}</small>
        </article>
      ))}
    </div>
  );
}

function AccountsAdmin({ accounts, onCreateAccountAdjustment }: { accounts: AdminCustomerAccount[]; onCreateAccountAdjustment: (customerId: string, event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const normalized = search.trim().toLowerCase();
  const filteredAccounts = normalized
    ? accounts.filter((account) => [account.customer.firstName, account.customer.lastName, account.customer.email, account.customer.phone, balanceText(account.currentBalance)].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
    : accounts;
  const selectedAccount = accounts.find((candidate) => candidate.customerId === selectedCustomerId) ?? null;
  const totalDebt = accounts.reduce((total, account) => total + Math.max(account.currentBalance, 0), 0);
  const customersWithDebt = accounts.filter((account) => account.currentBalance > 0).length;

  return (
    <section className="adminPage">
      <div className="adminPageHeader"><div><p className="eyebrow">Cuentas corrientes</p><h2>Saldos de clientes.</h2><p>Consulta deuda, saldo a favor y registra ajustes manuales auditables.</p></div><div className="adminStats"><span>{accounts.length} cuentas</span><span>{customersWithDebt} con deuda</span><span>{formatPrice(totalDebt)} a cobrar</span></div></div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Clientes</h3><span>{filteredAccounts.length} de {accounts.length} registros</span></div></div>
        <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cliente, email, telefono o saldo" />
        {filteredAccounts.length === 0 ? <p className="statusText">No encontramos cuentas con ese filtro.</p> : null}
        {filteredAccounts.length > 0 ? <div className="adminTable">{filteredAccounts.map((account) => <button className="adminTableRow accountTableRow" key={account.id} type="button" onClick={() => setSelectedCustomerId(account.customerId)}><span><strong>{account.customer.firstName} {account.customer.lastName}</strong><small>{account.customer.email}</small></span><span className={`pill ${account.currentBalance > 0 ? 'warning' : 'ok'}`}>{balanceText(account.currentBalance)}</span><span>{account.movementCount} movimientos</span><span>{account.lastMovementAt ? new Date(account.lastMovementAt).toLocaleDateString('es-AR') : 'Sin movimientos'}</span></button>)}</div> : null}
      </section>
      {selectedAccount ? <AccountAdjustmentModal account={selectedAccount} onClose={() => setSelectedCustomerId('')} onCreateAccountAdjustment={onCreateAccountAdjustment} /> : null}
    </section>
  );
}

function AccountAdjustmentModal({ account, onClose, onCreateAccountAdjustment }: { account: AdminCustomerAccount; onClose: () => void; onCreateAccountAdjustment: (customerId: string, event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    await onCreateAccountAdjustment(account.customerId, event);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <form aria-labelledby="accountModalTitle" aria-modal="true" className="adminForm productModal" onKeyDown={(event) => handleModalKeyDown(event, onClose)} onSubmit={submitAdjustment} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">Cuenta corriente</p><h3 id="accountModalTitle">{account.customer.firstName} {account.customer.lastName}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <div className="adminStats"><span>{account.customer.email}</span><span>{balanceText(account.currentBalance)}</span></div>
        <div className="modalFields">
          <label>Tipo de ajuste<select name="direction" defaultValue="CREDIT" required><option value="CREDIT">Crédito: baja deuda o genera saldo a favor</option><option value="DEBIT">Débito: aumenta deuda</option></select></label>
          <label>Monto<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Motivo<textarea name="description" minLength={3} maxLength={600} rows={3} placeholder="Ej: cancelacion de deuda acordada, ajuste por diferencia, saldo inicial" required /></label>
        </div>
        <div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">Registrar ajuste</button></div>
      </form>
    </div>
  );
}

/*
function AdminPage(props: { user: AuthUser | null; navigate: (path: string) => void; products: CatalogProduct[]; categories: Category[]; orders: Order[]; users: AdminUser[]; selectedProduct: CatalogProduct | null; selectedProductId: string; setSelectedProductId: (id: string) => void; onCreateCategory: (event: FormEvent<HTMLFormElement>) => void; onCreateProduct: (event: FormEvent<HTMLFormElement>) => void; onUpdateProduct: (event: FormEvent<HTMLFormElement>) => void; onUpdateOrder: (id: string, status: string, paymentStatus: string) => void; onUpdateUser: (id: string, isActive: boolean, password?: string) => void }) {
  if (!isAdmin(props.user)) return <section className="section"><p className="statusText errorText">Necesitas permisos de admin.</p><button className="primary" type="button" onClick={() => props.navigate('/login')}>Ingresar</button></section>;
  return <section className="section adminPanel"><p className="eyebrow">Panel admin</p><h1>Gestion de tienda.</h1><div className="adminTabs"><ProductAdmin {...props} /><OrderAdmin orders={props.orders} onUpdateOrder={props.onUpdateOrder} /><UserAdmin users={props.users} onUpdateUser={props.onUpdateUser} /></div></section>;
}

function ProductAdmin({ products, categories, selectedProduct, selectedProductId, setSelectedProductId, onCreateCategory, onCreateProduct, onUpdateProduct }: Parameters<typeof AdminPage>[0]) {
  return <section className="adminBlock"><h2>Productos</h2><div className="adminGrid"><form className="adminForm" onSubmit={onCreateCategory}><h3>Nueva categoria</h3><label>Nombre<input name="categoryName" required /></label><label>Slug opcional<input name="categorySlug" /></label><button type="submit">Crear categoria</button></form><form className="adminForm" onSubmit={onCreateProduct}><h3>Nuevo producto</h3><label>Categoria<select name="categoryId" defaultValue=""><option value="">Sin categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Nombre<input name="productName" required /></label><label>Slug opcional<input name="productSlug" /></label><label>Linea<input name="line" /></label><label>Descripcion<textarea name="description" rows={4} /></label><label>Imagen<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><div className="formRow"><label>SKU<input name="sku" required /></label><label>Variante<input name="variantName" required defaultValue="Unidad" /></label></div><div className="formRow"><label>Stock<input name="stockQuantity" type="number" min="0" required defaultValue="0" /></label><label>Precio<input name="price" type="number" min="0.01" step="0.01" required /></label></div><button type="submit">Crear producto</button></form><section className="adminForm productManager"><h3>Productos existentes</h3><div className="adminProductList">{products.map((product) => <button className={product.id === selectedProductId ? 'productListItem active' : 'productListItem'} key={product.id} type="button" onClick={() => setSelectedProductId(product.id)}><span>{product.name}</span><small>{product.variants[0]?.stockQuantity ?? 0} u.</small></button>)}</div></section>{selectedProduct ? <form className="adminForm productEditor" key={selectedProduct.id} onSubmit={onUpdateProduct}><h3>Editar producto</h3><input name="editProductId" type="hidden" value={selectedProduct.id} /><label>Categoria<select name="editCategoryId" defaultValue={selectedProduct.category?.id ?? ''}><option value="">Sin categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Nombre<input name="editProductName" required defaultValue={selectedProduct.name} /></label><label>Slug<input name="editProductSlug" required defaultValue={selectedProduct.slug} /></label><label>Linea<input name="editLine" defaultValue={selectedProduct.line ?? ''} /></label><label>Descripcion<textarea name="editDescription" rows={4} defaultValue={selectedProduct.description ?? ''} /></label><label>Reemplazar imagen<input name="editImage" type="file" accept="image/jpeg,image/png,image/webp" /></label><label className="checkboxLabel"><input name="editIsActive" type="checkbox" defaultChecked={selectedProduct.isActive} />Producto activo</label><div className="formRow"><label>SKU<input name="editSku" required defaultValue={selectedProduct.variants[0]?.sku ?? ''} /></label><label>Variante<input name="editVariantName" required defaultValue={selectedProduct.variants[0]?.name ?? 'Unidad'} /></label></div><div className="formRow"><label>Stock<input name="editStockQuantity" type="number" min="0" required defaultValue={selectedProduct.variants[0]?.stockQuantity ?? 0} /></label><label>Precio<input name="editPrice" type="number" min="0.01" step="0.01" required defaultValue={selectedProduct.variants[0]?.currentPrice?.amount ?? ''} /></label></div><button type="submit">Guardar cambios</button></form> : null}</div></section>;
}

function OrderAdmin({ orders, onUpdateOrder }: { orders: Order[]; onUpdateOrder: (id: string, status: string, paymentStatus: string) => void }) {
  return <section className="adminBlock"><h2>Pedidos</h2>{orders.length === 0 ? <p className="statusText">Todavia no hay pedidos.</p> : <div className="orderAdminList">{orders.map((order) => <article className="orderCard" key={order.id}><div><strong>{order.customer.firstName} {order.customer.lastName}</strong><p>{order.customer.email}</p><p>Total {formatPrice(order.total)}</p></div><div className="formRow"><select defaultValue={order.status} onChange={(event) => onUpdateOrder(order.id, event.target.value, order.paymentStatus)}><option value="PENDING">Pendiente</option><option value="CONFIRMED">Confirmado</option><option value="PREPARING">Preparando</option><option value="DELIVERED">Entregado</option><option value="CANCELLED">Cancelado</option></select><select defaultValue={order.paymentStatus} onChange={(event) => onUpdateOrder(order.id, order.status, event.target.value)}><option value="UNPAID">Sin pago</option><option value="PARTIALLY_PAID">Pago parcial</option><option value="PAID">Pagado</option><option value="REFUNDED">Reembolsado</option></select></div></article>)}</div>}</section>;
}

function UserAdmin({ users, onUpdateUser }: { users: AdminUser[]; onUpdateUser: (id: string, isActive: boolean, password?: string) => void }) {
  return <section className="adminBlock"><h2>Clientes</h2>{users.length === 0 ? <p className="statusText">Todavia no hay clientes registrados.</p> : <div className="userGrid">{users.map((user) => <form className="adminForm userCard" key={user.id} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void onUpdateUser(user.id, form.get('isActive') === 'on', String(form.get('password') ?? '')); }}><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span><label className="checkboxLabel"><input name="isActive" type="checkbox" defaultChecked={user.isActive} />Usuario activo</label><label>Nueva contrasena opcional<input name="password" type="password" minLength={8} /></label><button type="submit">Guardar usuario</button></form>)}</div>}</section>;
}
*/

type AdminPageProps = {
  user: AuthUser | null;
  navigate: (path: string) => void;
  path: string;
  products: CatalogProduct[];
  categories: Category[];
  deliveryMethods: DeliveryMethod[];
  orders: Order[];
  users: AdminUser[];
  accounts: AdminCustomerAccount[];
  promotions: Promotion[];
  selectedProduct: CatalogProduct | null;
  selectedProductId: string;
  setSelectedProductId: (id: string) => void;
  onCreateCategory: (event: FormEvent<HTMLFormElement>) => void;
  onCreateProduct: AdminFormSubmit;
  onUpdateProduct: AdminFormSubmit;
  onUpdateOrder: (id: string, status: string, paymentStatus: string) => void | Promise<void>;
  onUpdateOrderDetails: (id: string, payload: { deliveryMethodId: string | null; deliveryAddress: string | null; deliveryNotes: string | null; items: Array<{ variantId: string; quantity: number }> }) => void | Promise<void>;
  onUpdateUser: (id: string, isActive: boolean, password?: string) => void | Promise<void>;
  onUpsertDeliveryMethod: AdminFormSubmit;
  onRegisterPayment: (id: string, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onCreateAccountAdjustment: (customerId: string, event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onUpsertPromotion: AdminFormSubmit;
};

function AdminPage(props: AdminPageProps) {
  const currentPath = props.path === '/admin' ? '/admin/productos' : props.path;

  if (!isAdmin(props.user)) {
    return <section className="section"><p className="statusText errorText">Necesitas permisos de admin.</p><button className="primary" type="button" onClick={() => props.navigate('/login')}>Ingresar</button></section>;
  }

  return (
    <section className="section adminPanel adminShell">
      <aside className="adminSidebar">
        <p className="eyebrow">Panel admin</p>
        <h1>Gestion profesional.</h1>
        <p>Productos, pedidos, clientes y configuracion separados para trabajar sin pantallas saturadas.</p>
        <nav className="adminNav" aria-label="Administracion">
          {[
            ['/admin/productos', 'Productos'],
            ['/admin/pedidos', 'Pedidos'],
            ['/admin/cuentas', 'Cuentas corrientes'],
            ['/admin/promociones', 'Promociones'],
            ['/admin/usuarios', 'Usuarios'],
            ['/admin/configuracion', 'Configuracion'],
          ].map(([href, label]) => <button className={currentPath === href ? 'active' : ''} key={href} type="button" onClick={() => { props.setSelectedProductId(''); props.navigate(href); }}>{label}</button>)}
        </nav>
      </aside>
      <div className="adminWorkspace">
        {currentPath === '/admin/pedidos' ? <OrderAdminModern orders={props.orders} products={props.products} onRegisterPayment={props.onRegisterPayment} onUpdateOrder={props.onUpdateOrder} onUpdateOrderDetails={props.onUpdateOrderDetails} /> : null}
        {currentPath === '/admin/cuentas' ? <AccountsAdmin accounts={props.accounts} onCreateAccountAdjustment={props.onCreateAccountAdjustment} /> : null}
        {currentPath === '/admin/promociones' ? <PromotionsAdmin categories={props.categories} products={props.products} promotions={props.promotions} onUpsertPromotion={props.onUpsertPromotion} /> : null}
        {currentPath === '/admin/usuarios' ? <UserAdminModern users={props.users} onUpdateUser={props.onUpdateUser} /> : null}
        {currentPath === '/admin/configuracion' ? <SettingsAdmin deliveryMethods={props.deliveryMethods} onUpsertDeliveryMethod={props.onUpsertDeliveryMethod} /> : null}
        {!['/admin/pedidos', '/admin/cuentas', '/admin/promociones', '/admin/usuarios', '/admin/configuracion'].includes(currentPath) ? <ProductAdminModern {...props} /> : null}
      </div>
    </section>
  );
}

function PromotionsAdmin({ categories, products, promotions, onUpsertPromotion }: { categories: Category[]; products: CatalogProduct[]; promotions: Promotion[]; onUpsertPromotion: AdminFormSubmit }) {
  const variantOptions = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPromotionId, setSelectedPromotionId] = useState('');
  const activePromotions = promotions.filter((promotion) => promotion.isActive).length;
  const normalized = search.trim().toLowerCase();
  const filteredPromotions = normalized
    ? promotions.filter((promotion) => [promotion.name, promotion.scope, promotion.discountType, promotionTargetLabel(promotion, products, categories)].some((value) => String(value).toLowerCase().includes(normalized)))
    : promotions;
  const selectedPromotion = promotions.find((promotion) => promotion.id === selectedPromotionId) ?? null;

  return (
    <section className="adminPage">
      <div className="adminPageHeader"><div><p className="eyebrow">Promociones</p><h2>Descuentos simples.</h2><p>Visualiza el listado limpio y abre cada promocion en modal para crear o editar detalles.</p></div><div className="adminStats"><span>{promotions.length} promociones</span><span>{activePromotions} activas</span></div></div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Todas las promociones</h3><span>{filteredPromotions.length} de {promotions.length} registros</span></div><button className="primary" type="button" onClick={() => setIsCreateOpen(true)}>Nueva promocion</button></div>
        <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por nombre, alcance, tipo u objetivo" />
        {promotions.length === 0 ? <p className="statusText">Todavia no hay promociones cargadas.</p> : null}
        {promotions.length > 0 && filteredPromotions.length === 0 ? <p className="statusText">No encontramos promociones con ese filtro.</p> : null}
        {filteredPromotions.length > 0 ? <div className="adminTable">{filteredPromotions.map((promotion) => <button className="adminTableRow promotionTableRow" key={promotion.id} type="button" onClick={() => setSelectedPromotionId(promotion.id)}><span><strong>{promotion.name}</strong><small>{promotionTargetLabel(promotion, products, categories)}</small></span><span>{promotionScopeLabel(promotion.scope)}</span><span>{promotionDiscountLabel(promotion)}</span><span className={promotion.isActive ? 'pill ok' : 'pill muted'}>{promotion.isActive ? 'Activa' : 'Pausada'}</span><span>Prioridad {promotion.priority}</span></button>)}</div> : null}
      </section>
      {isCreateOpen ? <PromotionModal categories={categories} products={products} variantOptions={variantOptions} onClose={() => setIsCreateOpen(false)} onUpsertPromotion={onUpsertPromotion} /> : null}
      {selectedPromotion ? <PromotionModal categories={categories} products={products} promotion={selectedPromotion} variantOptions={variantOptions} onClose={() => setSelectedPromotionId('')} onUpsertPromotion={onUpsertPromotion} /> : null}
    </section>
  );
}

function promotionScopeLabel(scope: Promotion['scope']) {
  if (scope === 'PRODUCT') return 'Producto';
  if (scope === 'VARIANT') return 'Variante';
  if (scope === 'CATEGORY') return 'Categoria';
  return 'Catalogo';
}

function promotionDiscountLabel(promotion: Promotion) {
  if (promotion.discountType === 'PERCENTAGE') return `${promotion.value}%`;
  if (promotion.discountType === 'FIXED_AMOUNT') return `${formatPrice(promotion.value)} off`;
  return `Precio ${formatPrice(promotion.value)}`;
}

function promotionTargetLabel(promotion: Promotion, products: CatalogProduct[], categories: Category[]) {
  if (promotion.scope === 'CATEGORY') return categories.find((category) => category.id === promotion.categoryId)?.name ?? 'Categoria sin identificar';
  if (promotion.scope === 'VARIANT') {
    const match = products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))).find(({ variant }) => variant.id === promotion.variantId);
    return match ? `${match.product.name} · ${match.variant.name}` : 'Variante sin identificar';
  }
  if (promotion.scope === 'PRODUCT') return products.find((product) => product.id === promotion.productId)?.name ?? 'Producto sin identificar';
  return 'Catalogo';
}

function PromotionModal({ categories, products, promotion, variantOptions, onClose, onUpsertPromotion }: { categories: Category[]; products: CatalogProduct[]; promotion?: Promotion; variantOptions: Array<{ product: CatalogProduct; variant: CatalogProduct['variants'][number] }>; onClose: () => void; onUpsertPromotion: AdminFormSubmit }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<Promotion['scope']>(promotion?.scope ?? 'PRODUCT');
  const targetOptions = scope === 'CATEGORY'
    ? categories.map((category) => ({ id: category.id, label: category.name }))
    : scope === 'VARIANT'
      ? variantOptions.map(({ product, variant }) => ({ id: variant.id, label: `${product.name} · ${variant.name}` }))
      : products.map((product) => ({ id: product.id, label: product.name }));
  const currentTargetId = promotion?.productId ?? promotion?.variantId ?? promotion?.categoryId ?? '';

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitPromotion(event: FormEvent<HTMLFormElement>) {
    await onUpsertPromotion(event);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <form aria-labelledby="promotionModalTitle" aria-modal="true" className="adminForm productModal" key={promotion?.id ?? 'new-promotion'} onKeyDown={(event) => handleModalKeyDown(event, onClose)} onSubmit={submitPromotion} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">{promotion ? 'Detalle de promocion' : 'Nueva promocion'}</p><h3 id="promotionModalTitle">{promotion?.name ?? 'Crear descuento'}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <input name="promotionId" type="hidden" value={promotion?.id ?? ''} />
        <div className="modalFields">
          <label>Nombre<input name="name" defaultValue={promotion?.name ?? ''} required /></label>
          <div className="formRow"><label>Alcance<select name="scope" value={scope} onChange={(event) => setScope(event.target.value as Promotion['scope'])}><option value="PRODUCT">Producto</option><option value="VARIANT">Variante</option><option value="CATEGORY">Categoria</option></select></label><label>Objetivo<select name="targetId" defaultValue={currentTargetId} required>{targetOptions.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label></div>
          <div className="formRow"><label>Tipo<select name="discountType" defaultValue={promotion?.discountType ?? 'PERCENTAGE'}><option value="PERCENTAGE">Porcentaje</option><option value="FIXED_AMOUNT">Monto fijo</option><option value="FIXED_PRICE">Precio final</option></select></label><label>Valor<input name="value" type="number" min="0.01" step="0.01" defaultValue={promotion?.value ?? ''} required /></label></div>
          <div className="formRow"><label>Prioridad<input name="priority" type="number" min="0" defaultValue={promotion?.priority ?? 0} /></label><label className="checkboxLabel"><input name="isActive" type="checkbox" defaultChecked={promotion?.isActive ?? true} />Activa</label></div>
          <div className="formRow"><label>Desde<input name="startsAt" type="datetime-local" defaultValue={promotion?.startsAt ? promotion.startsAt.slice(0, 16) : ''} /></label><label>Hasta<input name="endsAt" type="datetime-local" defaultValue={promotion?.endsAt ? promotion.endsAt.slice(0, 16) : ''} /></label></div>
        </div>
        <div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">Guardar cambios</button></div>
      </form>
    </div>
  );
}

function ProductAdminModern({ products, categories, selectedProduct, selectedProductId, setSelectedProductId, onCreateCategory, onCreateProduct, onUpdateProduct }: AdminPageProps) {
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const totalStock = products.reduce((total, product) => total + (product.variants[0]?.availableStock ?? 0), 0);
  const activeProducts = products.filter((product) => product.isActive).length;
  const normalized = search.trim().toLowerCase();
  const filteredProducts = normalized
    ? products.filter((product) => [product.name, product.slug, product.description, product.line, product.category?.name, product.variants[0]?.sku].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
    : products;

  function openProduct(id: string) {
    setSelectedProductId(id);
  }

  function closeProduct() {
    setSelectedProductId('');
  }

  return (
    <section className="adminPage">
      <div className="adminPageHeader">
        <div><p className="eyebrow">Productos</p><h2>Catalogo administrable.</h2><p>Visualiza el listado limpio y abre cada producto en modal para ver o editar detalles.</p></div>
        <div className="adminStats"><span>{products.length} productos</span><span>{activeProducts} activos</span><span>{totalStock} disponibles</span></div>
      </div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Todos los productos</h3><span>{filteredProducts.length} de {products.length} registros</span></div><button className="primary" type="button" onClick={() => setIsCreateOpen(true)}>Agregar nuevo producto</button></div>
        <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por nombre, SKU, categoria o linea" />
        {products.length === 0 ? <p className="statusText">Todavia no hay productos cargados.</p> : null}
        {products.length > 0 && filteredProducts.length === 0 ? <p className="statusText">No encontramos productos con ese filtro.</p> : null}
        {filteredProducts.length > 0 ? <div className="adminTable">{filteredProducts.map((product) => {
          const variant = product.variants[0];
          return <button className="adminTableRow" key={product.id} type="button" onClick={() => openProduct(product.id)}><span><strong>{product.name}</strong><small>{product.category?.name ?? product.line ?? 'Sin categoria'}</small></span><span>{variant?.sku ?? 'Sin SKU'}</span><span>{variant?.currentPrice ? formatPrice(variant.currentPrice.amount) : 'Sin precio'}</span><span className={product.isActive ? 'pill ok' : 'pill muted'}>{product.isActive ? 'Activo' : 'Pausado'}</span><span>{variant?.availableStock ?? 0}/{variant?.stockQuantity ?? 0} u.</span></button>;
        })}</div> : null}
      </section>
      {isCreateOpen ? <CreateProductModal categories={categories} onClose={() => setIsCreateOpen(false)} onCreateCategory={onCreateCategory} onCreateProduct={onCreateProduct} /> : null}
      {selectedProduct ? <ProductModal product={selectedProduct} categories={categories} selectedProductId={selectedProductId} onClose={closeProduct} onUpdateProduct={onUpdateProduct} /> : null}
    </section>
  );
}

function CreateProductModal({ categories, onClose, onCreateCategory, onCreateProduct }: { categories: Category[]; onClose: () => void; onCreateCategory: (event: FormEvent<HTMLFormElement>) => void; onCreateProduct: AdminFormSubmit }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    await onCreateProduct(event);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div aria-labelledby="createProductModalTitle" aria-modal="true" className="productModal createProductModal" onKeyDown={(event) => handleModalKeyDown(event, onClose)} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">Nuevo producto</p><h3 id="createProductModalTitle">Cargar producto al catalogo</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <div className="createModalGrid">
          <form className="adminForm" onSubmit={submitProduct}><h3>Datos del producto</h3><label>Categoria<select name="categoryId" defaultValue=""><option value="">Sin categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Nombre<input name="productName" required /></label><label>Slug opcional<input name="productSlug" /></label><label>Linea<input name="line" /></label><label>Descripcion<textarea name="description" rows={3} /></label><label>Imagen<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><div className="formRow"><label>SKU<input name="sku" required /></label><label>Variante<input name="variantName" required defaultValue="Unidad" /></label></div><div className="formRow"><label>Stock<input name="stockQuantity" type="number" min="0" required defaultValue="0" /></label><label>Precio<input name="price" type="number" min="0.01" step="0.01" required /></label></div><div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">Publicar producto</button></div></form>
          <form className="adminForm quickCategory" onSubmit={onCreateCategory}><h3>Categoria rapida</h3><p>Si falta una categoria, creala aca y despues seleccionala en el producto.</p><label>Nombre<input name="categoryName" required /></label><label>Slug opcional<input name="categorySlug" /></label><button type="submit">Crear categoria</button></form>
        </div>
      </div>
    </div>
  );
}

function ProductModal({ product, categories, selectedProductId, onClose, onUpdateProduct }: { product: CatalogProduct; categories: Category[]; selectedProductId: string; onClose: () => void; onUpdateProduct: AdminFormSubmit }) {
  const variant = product.variants[0];
  const image = product.images[0];
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    await onUpdateProduct(event);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <form aria-labelledby="productModalTitle" aria-modal="true" className="adminForm productModal" key={selectedProductId} onKeyDown={(event) => handleModalKeyDown(event, onClose)} onSubmit={submitProduct} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">Detalle de producto</p><h3 id="productModalTitle">{product.name}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <div className="modalBody">
          <div className="modalPreview">{image ? <img src={imageSource(image.url)} alt={image.altText ?? product.name} /> : <span>Sin imagen</span>}<p>{product.description || 'Sin descripcion cargada.'}</p><div className="adminStats compact"><span>{variant?.currentPrice ? formatPrice(variant.currentPrice.amount) : 'Sin precio'}</span><span>{variant?.availableStock ?? 0} disponibles</span><span>{variant?.reservedQuantity ?? 0} reservados</span></div></div>
          <div className="modalFields">
            <input name="editProductId" type="hidden" value={product.id} />
            <label>Categoria<select name="editCategoryId" defaultValue={product.category?.id ?? ''}><option value="">Sin categoria</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Nombre<input name="editProductName" defaultValue={product.name} required /></label>
            <label>Slug<input name="editProductSlug" defaultValue={product.slug} required /></label>
            <label>Linea<input name="editLine" defaultValue={product.line ?? ''} /></label>
            <label>Descripcion<textarea name="editDescription" defaultValue={product.description ?? ''} rows={4} /></label>
            <label>Actualizar imagen<input name="editImage" type="file" accept="image/jpeg,image/png,image/webp" /></label>
            <div className="formRow"><label>SKU<input name="editSku" defaultValue={variant?.sku ?? ''} required /></label><label>Variante<input name="editVariantName" defaultValue={variant?.name ?? 'Unidad'} required /></label></div>
            <div className="formRow"><label>Stock<input name="editStockQuantity" type="number" min="0" defaultValue={variant?.stockQuantity ?? 0} required /></label><label>Precio<input name="editPrice" type="number" min="0.01" step="0.01" defaultValue={variant?.currentPrice?.amount ?? 0} required /></label></div>
            <label className="checkboxLabel"><input name="editIsActive" type="checkbox" defaultChecked={product.isActive} />Producto activo</label>
          </div>
        </div>
        <div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">Guardar cambios</button></div>
      </form>
    </div>
  );
}

function OrderAdminModern({ orders, products, onUpdateOrder, onUpdateOrderDetails, onRegisterPayment }: { orders: Order[]; products: CatalogProduct[]; onUpdateOrder: (id: string, status: string, paymentStatus: string) => void | Promise<void>; onUpdateOrderDetails: (id: string, payload: { deliveryMethodId: string | null; deliveryAddress: string | null; deliveryNotes: string | null; items: Array<{ variantId: string; quantity: number }> }) => void | Promise<void>; onRegisterPayment: (id: string, event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const variantOptions = products.flatMap((product) => product.variants.map((variant) => ({ product, variant })));
  const normalized = search.trim().toLowerCase();
  const filteredOrders = orders.filter((order) => {
    const matchesSearch = !normalized || [
      order.id,
      order.customer.firstName,
      order.customer.lastName,
      order.customer.email,
      order.customer.phone,
      order.deliveryMethod?.name,
      ...order.items.flatMap((item) => [item.productName, item.variantName]),
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
    return matchesSearch && (!statusFilter || order.status === statusFilter) && (!paymentFilter || order.paymentStatus === paymentFilter);
  });
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;
  const pendingOrders = orders.filter((order) => order.status === 'PENDING').length;
  const paidOrders = orders.filter((order) => order.paymentStatus === 'PAID').length;

  async function updateOrderItems(order: Order, items: Array<{ variantId: string; quantity: number }>) {
    await onUpdateOrderDetails(order.id, {
      deliveryMethodId: order.deliveryMethod?.id ?? null,
      deliveryAddress: order.deliveryAddress,
      deliveryNotes: order.deliveryNotes,
      items,
    });
  }

  return (
    <section className="adminPage">
      <div className="adminPageHeader">
        <div><p className="eyebrow">Pedidos</p><h2>Listado de pedidos.</h2><p>Busca, filtra y abri cada pedido para actualizar estados, pagos, items o entrega.</p></div>
        <div className="adminStats"><span>{orders.length} pedidos</span><span>{pendingOrders} pendientes</span><span>{paidOrders} pagados</span></div>
      </div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Todos los pedidos</h3><span>{filteredOrders.length} de {orders.length} registros</span></div></div>
        <div className="orderFilters">
          <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por cliente, email, producto o codigo" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado del pedido"><option value="">Todos los estados</option><option value="PENDING">Pendiente</option><option value="CONFIRMED">Confirmado</option><option value="PREPARING">Preparando</option><option value="DELIVERED">Entregado</option><option value="CANCELLED">Cancelado</option></select>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} aria-label="Filtrar por estado de pago"><option value="">Todos los pagos</option><option value="UNPAID">Sin pago</option><option value="PARTIALLY_PAID">Pago parcial</option><option value="PAID">Pagado</option><option value="REFUNDED">Reembolsado</option></select>
        </div>
        {orders.length === 0 ? <p className="statusText">Todavia no hay pedidos.</p> : null}
        {orders.length > 0 && filteredOrders.length === 0 ? <p className="statusText">No encontramos pedidos con esos filtros.</p> : null}
        {filteredOrders.length > 0 ? <div className="adminTable">{filteredOrders.map((order) => {
          const paidAmount = order.payments.reduce((total, payment) => total + payment.amount, 0);
          return <button className="adminTableRow orderTableRow" key={order.id} type="button" onClick={() => setSelectedOrderId(order.id)}><span><strong>Pedido {order.id.slice(0, 8)}</strong><small>{order.customer.firstName} {order.customer.lastName} · {order.customer.email}</small></span><span>{order.items.length} items</span><span>{formatPrice(order.total)}</span><span className={`pill ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</span><span className={`pill ${paymentStatusTone(order.paymentStatus)}`}>{paymentStatusLabel(order.paymentStatus)}</span><span>{formatPrice(paidAmount)} pagado</span></button>;
        })}</div> : null}
      </section>
      {selectedOrder ? <OrderModal order={selectedOrder} variantOptions={variantOptions} onClose={() => setSelectedOrderId('')} onRegisterPayment={onRegisterPayment} onUpdateOrder={onUpdateOrder} onUpdateOrderItems={updateOrderItems} /> : null}
    </section>
  );
}

function orderStatusLabel(status: string) {
  if (status === 'PENDING') return 'Pendiente';
  if (status === 'CONFIRMED') return 'Confirmado';
  if (status === 'PREPARING') return 'Preparando';
  if (status === 'DELIVERED') return 'Entregado';
  if (status === 'CANCELLED') return 'Cancelado';
  return status;
}

function paymentStatusLabel(status: string) {
  if (status === 'UNPAID') return 'Sin pago';
  if (status === 'PARTIALLY_PAID') return 'Pago parcial';
  if (status === 'PAID') return 'Pagado';
  if (status === 'REFUNDED') return 'Reembolsado';
  return status;
}

function orderStatusTone(status: string) {
  if (status === 'DELIVERED' || status === 'CONFIRMED') return 'ok';
  if (status === 'CANCELLED') return 'muted';
  return 'warning';
}

function paymentStatusTone(status: string) {
  if (status === 'PAID') return 'ok';
  if (status === 'REFUNDED') return 'muted';
  return 'warning';
}

const orderStatusFlow = ['PENDING', 'CONFIRMED', 'PREPARING', 'DELIVERED'];

function isOrderStatusOptionDisabled(currentStatus: string, nextStatus: string) {
  if (nextStatus === currentStatus) return false;
  if (currentStatus === 'DELIVERED' || currentStatus === 'CANCELLED') return true;
  if (nextStatus === 'CANCELLED') return false;

  const currentIndex = orderStatusFlow.indexOf(currentStatus);
  const nextIndex = orderStatusFlow.indexOf(nextStatus);
  return currentIndex >= 0 && nextIndex >= 0 && nextIndex < currentIndex;
}

function adminOrderErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'ORDER_STATUS_LOCKED') return 'Este pedido ya esta cerrado y no permite cambiar su estado operativo.';
  if (error instanceof Error) return error.message;
  return 'No se pudo actualizar el pedido.';
}

function OrderModal({ order, variantOptions, onClose, onUpdateOrder, onUpdateOrderItems, onRegisterPayment }: { order: Order; variantOptions: Array<{ product: CatalogProduct; variant: CatalogProduct['variants'][number] }>; onClose: () => void; onUpdateOrder: (id: string, status: string, paymentStatus: string) => void | Promise<void>; onUpdateOrderItems: (order: Order, items: Array<{ variantId: string; quantity: number }>) => void | Promise<void>; onRegisterPayment: (id: string, event: FormEvent<HTMLFormElement>) => void | Promise<void> }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [editingItemId, setEditingItemId] = useState('');
  const [quantityDraft, setQuantityDraft] = useState(1);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [orderStatus, setOrderStatus] = useState(order.status);
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus);
  const [modalError, setModalError] = useState<string | null>(null);
  const isEditable = ['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status);
  const paidAmount = order.payments.reduce((total, payment) => total + payment.amount, 0);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    setOrderStatus(order.status);
    setPaymentStatus(order.paymentStatus);
  }, [order.id, order.paymentStatus, order.status]);

  function currentItems() {
    return order.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
  }

  function startEditItem(item: Order['items'][number]) {
    setEditingItemId(item.id);
    setQuantityDraft(item.quantity);
  }

  async function saveItemQuantity(item: Order['items'][number]) {
    if (quantityDraft < 1) return;
    setModalError(null);
    try {
      await onUpdateOrderItems(order, currentItems().map((candidate) => (candidate.variantId === item.variantId ? { ...candidate, quantity: quantityDraft } : candidate)));
      setEditingItemId('');
    } catch (error) {
      setModalError(adminOrderErrorMessage(error));
    }
  }

  async function removeItem(item: Order['items'][number]) {
    if (order.items.length <= 1) return;
    setModalError(null);
    try {
      await onUpdateOrderItems(order, currentItems().filter((candidate) => candidate.variantId !== item.variantId));
    } catch (error) {
      setModalError(adminOrderErrorMessage(error));
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const variantId = String(form.get('addVariantId') ?? '');
    const quantity = Number(form.get('addQuantity') ?? 0);
    if (!variantId || quantity < 1) return;

    const items = currentItems();
    const existing = items.find((item) => item.variantId === variantId);
    if (existing) existing.quantity += quantity;
    else items.push({ variantId, quantity });
    setModalError(null);
    try {
      await onUpdateOrderItems(order, items);
      event.currentTarget.reset();
      setIsAddingItem(false);
    } catch (error) {
      setModalError(adminOrderErrorMessage(error));
    }
  }

  async function saveOrderStatus() {
    if (isOrderStatusOptionDisabled(order.status, orderStatus)) return;
    setModalError(null);
    try {
      await onUpdateOrder(order.id, orderStatus, paymentStatus);
    } catch (error) {
      setModalError(adminOrderErrorMessage(error));
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    setModalError(null);
    try {
      await onRegisterPayment(order.id, event);
    } catch (error) {
      setModalError(adminOrderErrorMessage(error));
    }
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <div aria-labelledby="orderModalTitle" aria-modal="true" className="productModal orderModal" onKeyDown={(event) => handleModalKeyDown(event, onClose)} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">Detalle de pedido</p><h3 id="orderModalTitle">Pedido {order.id.slice(0, 8)}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <div className="orderModalSummary">
          <article><span>Cliente</span><strong>{order.customer.firstName} {order.customer.lastName}</strong><small>{order.customer.email}{order.customer.phone ? ` · ${order.customer.phone}` : ''}</small></article>
          <article><span>Total</span><strong>{formatPrice(order.total)}</strong><small>Subtotal {formatPrice(order.subtotal)} · Entrega {formatPrice(order.deliveryCost)}</small></article>
          <article><span>Pagado</span><strong>{formatPrice(paidAmount)}</strong><small>{order.payments.length} pagos registrados</small></article>
        </div>
        {modalError ? <p className="statusText errorText modalError">{modalError}</p> : null}
        <div className="orderModalGrid">
          <section className="adminForm orderStatusPanel">
            <h3>Estado del pedido</h3>
            <div className="formRow">
              <label>Pedido<select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}><option value="PENDING" disabled={isOrderStatusOptionDisabled(order.status, 'PENDING')}>Pendiente</option><option value="CONFIRMED" disabled={isOrderStatusOptionDisabled(order.status, 'CONFIRMED')}>Confirmado</option><option value="PREPARING" disabled={isOrderStatusOptionDisabled(order.status, 'PREPARING')}>Preparando</option><option value="DELIVERED" disabled={isOrderStatusOptionDisabled(order.status, 'DELIVERED')}>Entregado</option><option value="CANCELLED" disabled={isOrderStatusOptionDisabled(order.status, 'CANCELLED')}>Cancelado</option></select></label>
              <label>Pago<select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value)}><option value="UNPAID">Sin pago</option><option value="PARTIALLY_PAID">Pago parcial</option><option value="PAID">Pagado</option><option value="REFUNDED">Reembolsado</option></select></label>
            </div>
            <button className="primary compactButton" type="button" disabled={(orderStatus === order.status && paymentStatus === order.paymentStatus) || isOrderStatusOptionDisabled(order.status, orderStatus)} onClick={saveOrderStatus}>Guardar cambios</button>
            <div className="orderItemsPreview">{order.items.map((item) => <div className="orderItemRow" key={item.id}><div><span>{item.quantity} x {item.productName}</span><strong>{formatPrice(item.lineTotal)}</strong><small>{item.variantName}</small></div>{editingItemId === item.id ? <div className="itemEditActions"><input aria-label={`Cantidad de ${item.productName}`} type="number" min="1" max="99" value={quantityDraft} onChange={(event) => setQuantityDraft(Number(event.target.value))} /><button className="compactButton" type="button" onClick={() => saveItemQuantity(item)}>Guardar</button><button className="secondaryButton compactButton" type="button" onClick={() => setEditingItemId('')}>Cancelar</button></div> : <div className="itemEditActions"><button className="iconActionButton" type="button" aria-label={`Editar cantidad de ${item.productName}`} disabled={!isEditable} onClick={() => startEditItem(item)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 16.5V20h3.5L18.1 9.4l-3.5-3.5L4 16.5Zm15.2-8.2 1.1-1.1a1.5 1.5 0 0 0 0-2.1l-1.4-1.4a1.5 1.5 0 0 0-2.1 0l-1.1 1.1 3.5 3.5Z" /></svg></button><button className="iconActionButton dangerButton" type="button" aria-label={`Eliminar ${item.productName}`} disabled={!isEditable || order.items.length <= 1} onClick={() => removeItem(item)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 21c-1.1 0-2-.9-2-2V7h14v12c0 1.1-.9 2-2 2H7ZM9 4h6l1 1h4v2H4V5h4l1-1Zm0 6v7h2v-7H9Zm4 0v7h2v-7h-2Z" /></svg></button></div>}</div>)}</div>
            <div className="addItemPanel">
              {!isAddingItem ? <button className="secondaryButton" type="button" disabled={!isEditable} onClick={() => setIsAddingItem(true)}>Sumar item o producto al pedido</button> : <form className="addItemForm" onSubmit={addItem}><label>Producto<select name="addVariantId" defaultValue="" required><option value="">Seleccionar producto</option>{variantOptions.map(({ product, variant }) => <option key={variant.id} value={variant.id}>{product.name} · {variant.name} · {variant.availableStock} disp.</option>)}</select></label><label>Cantidad<input name="addQuantity" type="number" min="1" max="99" defaultValue="1" required /></label><div className="modalActions"><button className="secondaryButton" type="button" onClick={() => setIsAddingItem(false)}>Cancelar</button><button type="submit">Sumar al pedido</button></div></form>}
            </div>
          </section>
          <form className="adminForm paymentForm" onSubmit={submitPayment}>
            <h3>Registrar pago</h3>
            <label>Monto<input name="amount" type="number" min="0.01" step="0.01" placeholder="0" required /></label>
            <label>Metodo<select name="method" defaultValue="" required><option value="" disabled>Seleccionar forma de pago</option>{PAYMENT_METHOD_OPTIONS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
            <label>Notas<input name="notes" placeholder="Referencia o comentario" /></label>
            <button className="compactButton" type="submit">Registrar pago</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function UserAdminModern({ users, onUpdateUser }: { users: AdminUser[]; onUpdateUser: (id: string, isActive: boolean, password?: string) => void | Promise<void> }) {
  const [search, setSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const activeUsers = users.filter((user) => user.isActive).length;
  const normalized = search.trim().toLowerCase();
  const filteredUsers = normalized
    ? users.filter((user) => [user.firstName, user.lastName, user.email, user.phone, user.role, user.isActive ? 'activo' : 'inactivo'].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
    : users;
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;

  return (
    <section className="adminPage">
      <div className="adminPageHeader"><div><p className="eyebrow">Usuarios</p><h2>Gestion de clientes.</h2><p>Busca usuarios registrados y abri el detalle en modal para activar, pausar o cambiar contrasena.</p></div><div className="adminStats"><span>{users.length} usuarios</span><span>{activeUsers} activos</span></div></div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Todos los usuarios</h3><span>{filteredUsers.length} de {users.length} registros</span></div></div>
        <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por nombre, email, telefono, rol o estado" />
        {users.length === 0 ? <p className="statusText">Todavia no hay clientes registrados.</p> : null}
        {users.length > 0 && filteredUsers.length === 0 ? <p className="statusText">No encontramos usuarios con ese filtro.</p> : null}
        {filteredUsers.length > 0 ? <div className="adminTable">{filteredUsers.map((adminUser) => <button className="adminTableRow userTableRow" key={adminUser.id} type="button" onClick={() => setSelectedUserId(adminUser.id)}><span><strong>{adminUser.firstName} {adminUser.lastName}</strong><small>{adminUser.email}</small></span><span>{adminUser.phone || 'Sin telefono'}</span><span>{adminUser.role}</span><span className={adminUser.isActive ? 'pill ok' : 'pill muted'}>{adminUser.isActive ? 'Activo' : 'Inactivo'}</span><span>Editar</span></button>)}</div> : null}
      </section>
      {selectedUser ? <UserModal user={selectedUser} onClose={() => setSelectedUserId('')} onUpdateUser={onUpdateUser} /> : null}
    </section>
  );
}

function UserModal({ user, onClose, onUpdateUser }: { user: AdminUser; onClose: () => void; onUpdateUser: (id: string, isActive: boolean, password?: string) => void | Promise<void> }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onUpdateUser(user.id, form.get('isActive') === 'on', String(form.get('password') ?? ''));
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <form aria-labelledby="userModalTitle" aria-modal="true" className="adminForm productModal" key={user.id} onKeyDown={(event) => handleModalKeyDown(event, onClose)} onSubmit={submitUser} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">Detalle de usuario</p><h3 id="userModalTitle">{user.firstName} {user.lastName}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <div className="modalFields">
          <div className="adminStats"><span>{user.email}</span><span>{user.role}</span><span>{user.phone || 'Sin telefono'}</span></div>
          <label className="checkboxLabel"><input name="isActive" type="checkbox" defaultChecked={user.isActive} />Usuario activo</label>
          <label>Nueva contrasena opcional<input name="password" type="password" minLength={8} placeholder="Dejar vacio para no cambiar" /></label>
        </div>
        <div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">Guardar usuario</button></div>
      </form>
    </div>
  );
}

function SettingsAdmin({ deliveryMethods, onUpsertDeliveryMethod }: { deliveryMethods: DeliveryMethod[]; onUpsertDeliveryMethod: AdminFormSubmit }) {
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState('');
  const activeMethods = deliveryMethods.filter((method) => method.isActive).length;
  const normalized = search.trim().toLowerCase();
  const filteredMethods = normalized
    ? deliveryMethods.filter((method) => [method.name, method.description, method.requiresAddress ? 'requiere direccion' : 'sin direccion', method.isActive ? 'activo' : 'inactivo'].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)))
    : deliveryMethods;
  const selectedMethod = deliveryMethods.find((method) => method.id === selectedMethodId) ?? null;

  return (
    <section className="adminPage">
      <div className="adminPageHeader"><div><p className="eyebrow">Configuracion</p><h2>Metodos de entrega.</h2><p>Centraliza costos y disponibilidad con listado filtrable y formularios en modal.</p></div><div className="adminStats"><span>{deliveryMethods.length} metodos</span><span>{activeMethods} activos</span></div></div>
      <section className="adminCard productListCard">
        <div className="cardHeader productToolbar"><div><h3>Metodos cargados</h3><span>{filteredMethods.length} de {deliveryMethods.length} registros</span></div><button className="primary" type="button" onClick={() => setIsCreateOpen(true)}>Nuevo metodo</button></div>
        <input className="searchInput adminSearch" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filtrar por nombre, descripcion o estado" />
        {deliveryMethods.length === 0 ? <p className="statusText">Todavia no hay metodos de entrega.</p> : null}
        {deliveryMethods.length > 0 && filteredMethods.length === 0 ? <p className="statusText">No encontramos metodos con ese filtro.</p> : null}
        {filteredMethods.length > 0 ? <div className="adminTable">{filteredMethods.map((method) => <button className="adminTableRow deliveryTableRow" key={method.id} type="button" onClick={() => setSelectedMethodId(method.id)}><span><strong>{method.name}</strong><small>{method.description || 'Sin descripcion'}</small></span><span>{formatPrice(method.cost)}</span><span>{method.requiresAddress ? 'Requiere direccion' : 'Sin direccion'}</span><span className={method.isActive ? 'pill ok' : 'pill muted'}>{method.isActive ? 'Activo' : 'Inactivo'}</span><span>Editar</span></button>)}</div> : null}
      </section>
      {isCreateOpen ? <DeliveryMethodModal onClose={() => setIsCreateOpen(false)} onUpsertDeliveryMethod={onUpsertDeliveryMethod} /> : null}
      {selectedMethod ? <DeliveryMethodModal method={selectedMethod} onClose={() => setSelectedMethodId('')} onUpsertDeliveryMethod={onUpsertDeliveryMethod} /> : null}
    </section>
  );
}

function DeliveryMethodModal({ method, onClose, onUpsertDeliveryMethod }: { method?: DeliveryMethod; onClose: () => void; onUpsertDeliveryMethod: AdminFormSubmit }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  async function submitDeliveryMethod(event: FormEvent<HTMLFormElement>) {
    await onUpsertDeliveryMethod(event);
    onClose();
  }

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <form aria-labelledby="deliveryMethodModalTitle" aria-modal="true" className="adminForm productModal" key={method?.id ?? 'new-delivery-method'} onKeyDown={(event) => handleModalKeyDown(event, onClose)} onSubmit={submitDeliveryMethod} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <div className="modalHeader"><div><p className="eyebrow">{method ? 'Detalle de metodo' : 'Nuevo metodo'}</p><h3 id="deliveryMethodModalTitle">{method?.name ?? 'Crear metodo de entrega'}</h3></div><button className="iconButton" ref={closeButtonRef} type="button" onClick={onClose}>Cerrar</button></div>
        <input name="deliveryMethodId" type="hidden" value={method?.id ?? ''} />
        <div className="modalFields">
          <label>Nombre<input name="deliveryName" defaultValue={method?.name ?? ''} required /></label>
          <label>Descripcion<input name="deliveryDescription" defaultValue={method?.description ?? ''} /></label>
          <label>Costo<input name="deliveryCost" type="number" min="0" step="0.01" defaultValue={method?.cost ?? ''} required /></label>
          <label className="checkboxLabel"><input name="deliveryRequiresAddress" type="checkbox" defaultChecked={method?.requiresAddress ?? true} />Requiere direccion</label>
          <label className="checkboxLabel"><input name="deliveryIsActive" type="checkbox" defaultChecked={method?.isActive ?? true} />Activo</label>
        </div>
        <div className="modalActions"><button className="secondaryButton" type="button" onClick={onClose}>Cancelar</button><button type="submit">{method ? 'Guardar cambios' : 'Crear metodo'}</button></div>
      </form>
    </div>
  );
}

function OrderList({ orders, onCancelOrder }: { orders: Order[]; onCancelOrder: (id: string) => void }) {
  return <div className="orderList">{orders.map((order) => <article className="orderCard" key={order.id}><div className="orderHeader"><strong>Pedido {order.id.slice(0, 8)}</strong><span>{order.status} · {order.paymentStatus}</span></div>{order.items.map((item) => <p key={item.id}>{item.quantity} x {item.productName} ({formatPrice(item.lineTotal)})</p>)}<strong>Total {formatPrice(order.total)}</strong>{order.status === 'PENDING' ? <button className="secondaryButton" type="button" onClick={() => onCancelOrder(order.id)}>Cancelar pedido pendiente</button> : null}</article>)}</div>;
}
