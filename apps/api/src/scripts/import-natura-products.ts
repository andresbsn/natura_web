import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

if (process.env.DATABASE_URL?.includes('host.docker.internal') && !fs.existsSync('/.dockerenv')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('host.docker.internal', 'localhost');
}

const prisma = new PrismaClient();

type NaturaSeedProduct = {
  productId: string;
  name: string;
  friendlyName?: string;
  brand: string;
  categoryId: string;
  categoryName: string;
  price: number;
  stockQuantity: number;
  shortDescription?: string | null;
  inStock: boolean;
  orderable: boolean;
};

const products: NaturaSeedProduct[] = [
  { productId: 'NATARG-155868', name: 'Desodorante en Spray Corporal Perfumado Paz e Humor 100 ml', brand: 'Humor', categoryId: 'cuidados-diarios-desodorante-spray', categoryName: 'en spray', price: 7450, stockQuantity: 10, shortDescription: 'protección con fragancia aromática moderada.', inStock: true, orderable: true },
  { productId: 'NATARG-1897', name: 'Beijo de Humor Femenino 75ml', friendlyName: 'Eau de Toilette Femenino Humor Beija Eu 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 61400, stockQuantity: 10, shortDescription: '<p>una invitación a una vida más atrevida y divertida.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-156165', name: 'Kaiak Femenino Eau de Toilette Miniatura 25 ml', friendlyName: 'Miniatura Eau de Toilette Femenino Kaiak 25ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 12800, stockQuantity: 10, shortDescription: '<p>frescura icónica inspirada en la fuerza de las aguas</p>', inStock: true, orderable: true },
  { productId: 'NATARG-1921', name: 'Beijo de Humor Masculino 75ml', friendlyName: 'Eau de Toilette Masculino Humor Me Beija 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 39910, stockQuantity: 10, shortDescription: '<p>¡una fragancia exclusiva que despierta las ganas de besar!</p>', inStock: true, orderable: true },
  { productId: 'NATARG-2834', name: 'Jabones En Barra Puro Vegetal Frutas Rojas Tododia 5x90g', friendlyName: 'Jabones en Barra Puro Vegetal Tododia Frutas Rojas 5 x 90 g c/u', brand: 'Tododia', categoryId: 'cuidados-diarios', categoryName: 'cuidados corporales', price: 8640, stockQuantity: 10, shortDescription: '<p>piel limpia, suave y naturalmente hidratada</p>', inStock: true, orderable: true },
  { productId: 'NATARG-69653', name: 'Desodorante Clasicco Roll on 75ml', friendlyName: 'Desodorante Roll On Kaiak Clásico Masculino 75 ml', brand: 'Kaiak', categoryId: 'cuidados-diarios', categoryName: 'cuidados corporales', price: 3900, stockQuantity: 10, shortDescription: null, inStock: true, orderable: true },
  { productId: 'NATARG-93641', name: 'Essencial Oud Eau De Parfum Femenino 100 ml', friendlyName: 'Essencial Oud EDP Femenino 100 ml', brand: 'Essencial', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 104100, stockQuantity: 10, shortDescription: '<p>una combinación sofisticada y envolvente</p>', inStock: true, orderable: true },
  { productId: 'NATARG-170153', name: 'Eau de Toilette Genderless Humor Envolve 75 ml', friendlyName: 'Eau de Toilette unisex Humor Envolve 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 42980, stockQuantity: 10, shortDescription: 'Fragancias que cautivan', inStock: true, orderable: true },
  { productId: 'NATARG-205937', name: 'Body Splash Tododia Fresa y Vainilla Dorada 200 ml', friendlyName: 'Body Splash Tododia Fresa y Vainilla Dorada', brand: 'Tododia', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 20735, stockQuantity: 10, shortDescription: 'un suspiro indulgente que evoca recuerdos dulces', inStock: true, orderable: true },
  { productId: 'NATARG-20834', name: 'Humor Liberta', friendlyName: 'Eau de Toilette unisex Humor Liberta 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 61400, stockQuantity: 10, shortDescription: '<p>perfume para quienes viven con ligereza y libertad</p>', inStock: true, orderable: true },
  { productId: 'NATARG-121969', name: 'Jabón en Barra Tododia Todanoche 5 unidades de 90 g', friendlyName: 'Jabón en Barra Tododia Todanoche', brand: 'Tododia', categoryId: 'cuidados-diarios-jabon-barra', categoryName: 'en barra', price: 9360, stockQuantity: 10, shortDescription: '<p>¡cuidá tu piel mientras te relajás!</p>', inStock: true, orderable: true },
  { productId: 'NATARG-70983', name: 'Crema Hidratante para Manos Ekos Castaña 75 g', brand: 'Ekos', categoryId: 'cuidados-diarios-hidratante-manos-pies', categoryName: 'para manos y pies', price: 9800, stockQuantity: 10, shortDescription: '48 horas de hidratación para las manos y uñas con el poder antirresequedad de la castaña.', inStock: true, orderable: true },
  { productId: 'NATARG-181896', name: 'Crema Nutritiva para el Cuerpo Tododia Mora y Flor de Durazno 400 ml', brand: 'Tododia', categoryId: 'cuidados-diarios-hidratante-corporal', categoryName: 'para el cuerpo', price: 12480, stockQuantity: 10, shortDescription: 'aprovechá el verano con la hidratación refrescante de mora y flor de durazno.', inStock: true, orderable: true },
  { productId: 'NATARG-111175', name: 'Kaiak Oceano EDT Masculino 100 ml', friendlyName: 'Eau de Toilette Masculino Kaiak Oceano 100ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 64000, stockQuantity: 10, shortDescription: '<p>la fuerza del océano en vos.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-129911', name: 'Desodorante Roll On Antitranspirante Prebiótico Tododia Cereza y Avellana 70 ml', brand: 'Tododia', categoryId: 'todos-productos', categoryName: 'todos productos', price: 4550, stockQuantity: 10, shortDescription: 'Proteccion para todos tus dias', inStock: true, orderable: true },
  { productId: 'NATARG-186', name: 'Homem Cor.agio Masculino Eau De Parfum 100 ml', friendlyName: 'Eau de Parfum Masculino Homem Cor.Agio 100ml', brand: 'Homem', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 99800, stockQuantity: 10, shortDescription: '<p>para quien enfrenta desafíos con estilo</p>', inStock: true, orderable: true },
  { productId: 'NATARG-206', name: 'Humor Paz e Humor Masculino EDT 25 ml', friendlyName: 'Eau de Toilette Masculino Paz e Humor 25ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 12350, stockQuantity: 10, shortDescription: '<p>una mezcla irreverente de energía, vibración e irresistible poder</p>', inStock: true, orderable: true },
  { productId: 'NATARG-64746', name: 'Meu Primeiro Humor eau de toilette femenina', friendlyName: 'Eau de Toilette Femenino Humor Primero 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 61400, stockQuantity: 10, shortDescription: '<p>el toque frutal que transforma el día</p>', inStock: true, orderable: true },
  { productId: 'NATARG-200122', name: 'Natura Homem Identidad Eau de Parfum 100 ml', brand: 'Homem', categoryId: 'perfumeria-eau-de-parfum', categoryName: 'eau de parfum', price: 81300, stockQuantity: 10, shortDescription: 'una invitación para expresar la fuerza de tu identidad', inStock: true, orderable: true },
  { productId: 'NATARG-72196', name: 'Body Splash Flor de Lis', friendlyName: 'Body splash Flor de Lis Tododia 200ml', brand: 'Tododia', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 15950, stockQuantity: 10, shortDescription: '<p>frescura y bienestar que despertán los sentidos</p>', inStock: true, orderable: true },
  { productId: 'NATARG-148459', name: 'Protector Termico Finalizador Lumina 150ml', friendlyName: 'Protector térmico Finalizador Lumina 150ml', brand: 'Lumina', categoryId: 'lumina', categoryName: 'lumina', price: 11940, stockQuantity: 10, shortDescription: '<p>nuevos envases, con un rendimiento aún más avanzado</p>', inStock: true, orderable: true },
  { productId: 'NATARG-111177', name: 'Kaiak Aventura Femenino', friendlyName: 'Eau de Toilette Femenino Kaiak Aventura 100ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 64000, stockQuantity: 10, shortDescription: '<p>frescura, libertad y aventura en cada nota</p>', inStock: true, orderable: true },
  { productId: 'NATARG-72195', name: 'Body Splash Tododia Macadamia 200 ml', friendlyName: 'Body splash Macadamia Tododia 200ml', brand: 'Tododia', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 15950, stockQuantity: 10, shortDescription: 'Fraganciasque cautivan', inStock: true, orderable: true },
  { productId: 'NATARG-111172', name: 'Kaiak urbe Masculino', friendlyName: 'Eau de Toilette Masculino Kaiak Urbe 100ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 39680, stockQuantity: 10, shortDescription: '<p>la ciudad arde. Vos refrescás.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-81950', name: 'Homem Potence EDP 100 ml', friendlyName: 'Eau de Parfum Masculino Homem Potence 100ml', brand: 'Homem', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 56910, stockQuantity: 10, shortDescription: '<p>tu forma de provocar</p>', inStock: true, orderable: true },
  { productId: 'NATARG-80936', name: 'Natura Ekos Pulpa para el Cuerpo Castana 400ml', friendlyName: 'Pulpa Hidratante Corporal Ekos Castaña 400 ml', brand: 'Ekos', categoryId: 'cuidados-diarios-hidratante-corporal', categoryName: 'para el cuerpo', price: 13850, stockQuantity: 10, shortDescription: '<p>revitalizá tu piel con el poder de la castaña</p>', inStock: true, orderable: true },
  { productId: 'NATARG-89185', name: 'Essence EDP Masculino Homem 25ml', friendlyName: 'Eau de Parfum Masculino Homem Essence 25ml', brand: 'Homem', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 16250, stockQuantity: 10, shortDescription: 'notas que exhalan fuerza y estilo', inStock: true, orderable: true },
  { productId: 'NATARG-83323', name: 'Kriska Shock Eau de Toilette Femenino 100ml', brand: 'Kriska', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 36050, stockQuantity: 10, shortDescription: '<p>descubrí la magia de Kriska Shock: una explosión de aromas dulces y femeninos.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-87512', name: 'Jabones En Barra Puro Vegetal Mora Roja y Jabuticaba Tododia 5x90g', friendlyName: 'Jabones en Barra Puro Vegetal Tododia Mora Roja y Jabuticaba 5 x 90 g c/u', brand: 'Tododia', categoryId: 'cuidados-diarios', categoryName: 'cuidados corporales', price: 8640, stockQuantity: 10, shortDescription: '<p>limpieza purificante y textura cremosa con la delicadeza de las frutas rojas</p>', inStock: true, orderable: true },
  { productId: 'NATARG-134575', name: 'Jabón en barra puro vegetal cremoso Ekos 4 un de 100 g', brand: 'Ekos', categoryId: 'veganos', categoryName: 'veganos', price: 13260, stockQuantity: 10, shortDescription: 'piel limpia y protegida con el poder de los activos amazónicos.', inStock: true, orderable: true },
  { productId: 'NATARG-189451', name: 'Desodorante Antitranspirante Roll On Erva Doce 70 ml', brand: 'Erva Doce', categoryId: 'cuidados-diarios-desodorante-roll-on', categoryName: 'roll on', price: 5525, stockQuantity: 10, shortDescription: 'Además de proteger y perfumar, evita manchas en la ropa.', inStock: true, orderable: true },
  { productId: 'NATARG-56768', name: 'Repuesto Spray Corporal Perfumado Femenino Humor propio', friendlyName: 'Repuesto Spray Corporal Perfumado Humor Próprio Femenino 100 ml', brand: 'Humor', categoryId: 'cuidados-diarios-desodorante', categoryName: 'desodorante', price: 8610, stockQuantity: 10, shortDescription: '<p>practicidad y sustentabilidad: el recambio de desodorante femenino</p>', inStock: true, orderable: true },
  { productId: 'NATARG-111171', name: 'Kaiak clásico eau de toilette masculino 100 ml', friendlyName: 'Eau de Toilette Masculino Kaiak Clásico 100ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 38400, stockQuantity: 10, shortDescription: '<p>sentí el poder de la frescura que renueva y revitaliza las energías.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-56740', name: 'Desodorante en Spray Corporal Perfumado Masculino Kaiak Urbe 100 ml', brand: 'Kaiak', categoryId: 'cuidados-diarios', categoryName: 'cuidados corporales', price: 12665, stockQuantity: 10, shortDescription: '<p>tecnología desodorante que protege contra los olores de la transpiración, con una fragancia perfecta para tu día a día.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-226604', name: 'Kit Repuestos Lumina Cabellos Lisos o Alisados', brand: 'Lumina', categoryId: 'todos-productos', categoryName: 'todos productos', price: 37200, stockQuantity: 10, shortDescription: 'limpieza equilibrada de larga duración, cabellos restaurados y reducción del frizz.', inStock: true, orderable: true },
  { productId: 'NATARG-93269', name: 'Kaiak Eau de Parfum Masculino 100 ml', brand: 'Kaiak', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 64960, stockQuantity: 10, shortDescription: '<p>el movimiento es el oxígeno de la vida</p>', inStock: true, orderable: true },
  { productId: 'NATARG-122945', name: 'Pulpa de manos pitanga preta 40g', friendlyName: 'Crema Hidratante para Manos Ekos Pitanga Preta 40g', brand: 'Ekos', categoryId: 'nuestros-produtos', categoryName: 'Nuestros Produtos', price: 5220, stockQuantity: 10, shortDescription: '<p>hidratación completa para las manos con la frescura de la pitanga</p>', inStock: true, orderable: true },
  { productId: 'NATARG-73575', name: 'Frescor Ekos Pitanga Preta 150 ml', brand: 'Ekos', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 30160, stockQuantity: 10, shortDescription: 'la fragancia vibrante y colorida de Pitanga Preta para tus días.', inStock: true, orderable: true },
  { productId: 'NATARG-163497', name: 'Desodorante Antitraspirante Invisible En Crema Erva Doce 80g', friendlyName: 'Desodorante Antitranspirante en Crema Erva Doce Invisible 80 g', brand: 'Erva Doce', categoryId: 'cuidados-diarios-desodorante', categoryName: 'desodorante', price: 4550, stockQuantity: 10, shortDescription: '<p>suavidad que protege y nutre tu piel</p>', inStock: true, orderable: true },
  { productId: 'NATARG-206232', name: 'Repuesto Crema Corporal Nutrición Radiante Tododia Pera y Flor de Loto 400 ml', brand: 'Tododia', categoryId: 'cuidados-diarios-hidratante-corporal', categoryName: 'para el cuerpo', price: 15700, stockQuantity: 10, shortDescription: 'piel 4 veces más hidratada.', inStock: true, orderable: true },
  { productId: 'NATARG-93619', name: 'Essencial Oud Eau De Parfum Masculino 100 ml', friendlyName: 'Essencial Oud EDP Masculino 100 ml', brand: 'Essencial', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 66624, stockQuantity: 10, shortDescription: '<p>intensidad amaderada con un toque brasileño</p>', inStock: true, orderable: true },
  { productId: 'NATARG-59848', name: 'Homem Essence EDP 100 ml', friendlyName: 'Eau de Parfum Masculino Homem Essence 100ml', brand: 'Homem', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 81300, stockQuantity: 10, shortDescription: '<p>notas que exhalan fuerza y estilo</p>', inStock: true, orderable: true },
  { productId: 'NATARG-76383', name: 'Body Splash Frambuesa y Pimienta Rosa', friendlyName: 'Body splash Frambuesa y Pimienta Rosa Tododia 200ml', brand: 'Tododia', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 31900, stockQuantity: 10, shortDescription: '<p>una invitación a vestir el cuerpo con un perfume fresco</p>', inStock: true, orderable: true },
  { productId: 'NATARG-169170', name: 'Essencial Supreme EDP Masculino 100 ml', friendlyName: 'Eau de Parfum Masculino Essencial Supreme 100ml', brand: 'Essencial', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 67665, stockQuantity: 10, shortDescription: '<p>una expresión de intensidad</p>', inStock: true, orderable: true },
  { productId: 'NATARG-18237', name: 'Body Splash Tododia frambuesa y pimienta roja 200 ml', friendlyName: 'Body splash Frambuesa y pimienta roja Tododia 200ml', brand: 'Tododia', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 15950, stockQuantity: 10, shortDescription: 'Perfume increible ¡para todos los días!', inStock: true, orderable: true },
  { productId: 'NATARG-64748', name: 'Humor a Dois EDT Masculino 75 ml', friendlyName: 'Eau de Toilette Masculino Humor a Dois 75ml', brand: 'Humor', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 39910, stockQuantity: 10, shortDescription: '<p>una invitación a romper la seriedad cotidiana.</p>', inStock: true, orderable: true },
  { productId: 'NATARG-190851', name: 'Desodorante Antitranspirante Roll-on Tododia Piel Uniforme 70 ml', brand: 'Tododia', categoryId: 'cuidados-diarios-desodorante-roll-on', categoryName: 'roll on', price: 4875, stockQuantity: 10, shortDescription: 'protege, hidrata y acoge todos los tonos de piel.', inStock: true, orderable: true },
  { productId: 'NATARG-73574', name: 'Frescor Ekos Maracuyá 150 ml', brand: 'Ekos', categoryId: 'perfumeria-para-quien', categoryName: 'para quién', price: 46400, stockQuantity: 10, shortDescription: 'fragancia encantadora y refrescante como un descanso en el vaivén de una hamaca.', inStock: true, orderable: true },
];

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function cleanDescription(value?: string | null) {
  return value?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
}

async function main() {
  let imported = 0;

  for (const item of products) {
    const productName = item.friendlyName ?? item.name;
    const productSlug = `${slugify(productName)}-${item.productId.toLowerCase()}`;
    const category = await prisma.category.upsert({
      where: { slug: item.categoryId },
      update: { name: item.categoryName, isActive: true },
      create: { name: item.categoryName, slug: item.categoryId, isActive: true },
    });

    await prisma.product.upsert({
      where: { slug: productSlug },
      update: {
        categoryId: category.id,
        name: productName,
        description: cleanDescription(item.shortDescription),
        line: item.brand,
        isActive: item.orderable && item.inStock,
        variants: {
          upsert: [
            {
              where: { sku: item.productId },
              update: {
                name: 'Unidad',
                stockQuantity: item.stockQuantity,
                isActive: item.orderable && item.inStock,
                prices: {
                  deleteMany: {},
                  create: { amount: item.price },
                },
              },
              create: {
                sku: item.productId,
                name: 'Unidad',
                stockQuantity: item.stockQuantity,
                isActive: item.orderable && item.inStock,
                prices: { create: { amount: item.price } },
              },
            },
          ],
        },
      },
      create: {
        categoryId: category.id,
        name: productName,
        slug: productSlug,
        description: cleanDescription(item.shortDescription),
        line: item.brand,
        isActive: item.orderable && item.inStock,
        variants: {
          create: {
            sku: item.productId,
            name: 'Unidad',
            stockQuantity: item.stockQuantity,
            isActive: item.orderable && item.inStock,
            prices: { create: { amount: item.price } },
          },
        },
      },
    });

    imported += 1;
  }

  console.log(`Imported ${imported} Natura products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
