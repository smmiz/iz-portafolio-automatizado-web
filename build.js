// Importar las librerías necesarias
const path = require('path');
const fs = require('fs-extra');
const ejs = require('ejs');
require('dotenv').config(); // Carga las variables de entorno desde .env
const cloudinary = require('cloudinary').v2; // Importar Cloudinary SDK
const Airtable = require('airtable'); // Importar Airtable SDK

// --- CONFIGURACIÓN DE RUTAS DEL PROYECTO ---
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const OUTPUT_DIR = path.join(process.cwd(), 'public');
const CSS_SOURCE_PATH = path.join(process.cwd(), 'src', 'css', 'style.css');
const CSS_OUTPUT_PATH = path.join(OUTPUT_DIR, 'style.css');

// --- CONFIGURACIÓN DE CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true // Usar HTTPS
});

// --- CONFIGURACIÓN DE AIRTABLE ---
// Se asume que AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME están en tus variables de entorno

// --- AÑADE ESTAS LÍNEAS DE DEPURACIÓN TEMPORALMENTE ---
// Esto imprimirá los valores que tu script está leyendo para Airtable
console.log("DEBUG: AIRTABLE_API_KEY (parcial):", process.env.AIRTABLE_API_KEY ? process.env.AIRTABLE_API_KEY.substring(0, 10) + '...' + process.env.AIRTABLE_API_KEY.substring(process.env.AIRTABLE_API_KEY.length - 10) : 'NO CONFIGURADO');
console.log("DEBUG: AIRTABLE_BASE_ID:", process.env.AIRTABLE_BASE_ID);
console.log("DEBUG: AIRTABLE_TABLE_NAME:", process.env.AIRTABLE_TABLE_NAME);
// --- FIN DE LÍNEAS DE DEPURACIÓN ---

Airtable.configure({
    apiKey: process.env.AIRTABLE_API_KEY
});
const base = Airtable.base(process.env.AIRTABLE_BASE_ID);
const table = base(process.env.AIRTABLE_TABLE_NAME);

// --- FUNCIONES DE AYUDA (HELPERS) ---

/**
 * Obtiene los datos de los modelos desde Airtable.
 */
async function fetchAirtableData() {
    console.log('Fetching model data from Airtable...');
    const records = await table.select({
        // Puedes añadir filtros, orden, etc. aquí si es necesario
        view: "Grid view" // Asegúrate de que esta vista exista y contenga todos los campos
    }).all();

    if (!records || records.length === 0) {
        console.log('No data found in Airtable.');
        return [];
    }

    const models = records.map(record => ({
        // CAMPOS DE AIRTABLE MAPEADOS USANDO SUS IDs CONFIRMADOS:
        modelSlug: record.fields['fld9vLUQR8KXZO3lv1']?.trim() || '', // ID para 'Model Slug'
        fullName: record.fields['fldFVg6vx7gjZSHMk']?.trim() || '',  // ID para 'Name'
        
        // Lógica CORREGIDA para el 'gender' para que sea 'men' o 'women'
        gender: (record.fields['fld9HTVM0bLVorJie']?.trim().toLowerCase() === 'female' ? 'women' :
                 (record.fields['fld9HTVM0bLVorJie']?.trim().toLowerCase() === 'male' ? 'men' : 'unassigned')),
        
        // --- ATENCIÓN: Obtén el ID de 'Description' si lo usas, o elimina esta línea ---
        description: record.fields['fld_ID_DE_DESCRIPTION']?.trim() || '', // Ejemplo: record.fields['fldxxxxxxxx_DESCRIPTION']
        
        instagramHandle: record.fields['fldrVMtYmCBSjehp6']?.trim() || '',
        tiktokHandle: record.fields['fldppDeNSP09xzR5L']?.trim() || '',

        height: record.fields['fldAtptfqNzRFn911'] || null, 
        eyes: record.fields['fldazLqtrLsqWtbtf']?.trim() || '',
        bust: record.fields['fldJxhpmO2vUTsV5h'] || null,
        waist: record.fields['fldedpGBWy6A6S8eO'] || null,
        hips: record.fields['fldmmy2s0Sr1cjPbu'] || null,
        shoes: record.fields['fldbyy1rmRHCGNmQz'] || null
        
        // Si tienes otros campos o un campo para la URL de la foto de perfil/portada
        // profilePhotoUrl: record.fields['fld_ID_DE_PROFILE_PHOTO_URL'] || '', 
    }));
    console.log(`Successfully fetched ${models.length} data rows from Airtable.`);
    return models;
}

/**
 * Obtiene una lista de URLs de imágenes de una carpeta de Cloudinary.
 * Esta función usa la API de Cloudinary para listar los recursos dentro de un prefijo (carpeta).
 */
async function getImagesFromFolder(folderPath) { // folderPath será un prefijo de Cloudinary, ej. "iz_management_website/portfolios/juan_lopez"
    if (!folderPath) {
        console.warn('getImagesFromFolder (Cloudinary): Missing folderPath. Returning empty array.');
        return [];
    }
    try {
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: folderPath, // Filtra por la carpeta (prefijo) en Cloudinary
            max_results: 500,    // Límite de resultados de la API de Cloudinary, ajusta según tus necesidades
            resource_type: 'image'
        });
        
        const imageUrls = result.resources.map(resource => {
            // Genera la URL de la imagen, con optimización automática
            // Puedes añadir transformaciones aquí si lo deseas (ej. width: 1200, crop: "limit")
            return cloudinary.url(resource.public_id, {
                secure: true, // Siempre usar HTTPS
                quality: "auto", 
                fetch_format: "auto"
            });
        });
        console.log(`Found ${imageUrls.length} images in Cloudinary folder: ${folderPath}.`);
        return imageUrls;
    } catch (error) {
        console.error(`Error getting images from Cloudinary folder ${folderPath}:`, error.message);
        throw error; // Re-lanza el error para que la construcción falle si hay un problema crítico
    }
}

/**
 * Construye la URL de la imagen de portada desde Cloudinary.
 * Asume una estructura de carpeta lógica en Cloudinary, ej. "iz_management_website/covers/men/model_slug.jpg".
 * El 'publicId' es la ruta completa de la imagen en Cloudinary sin la extensión.
 */
function getCoverImageUrl(modelSlug, gender) {
    // Ajusta 'iz_management_website/covers' si tu carpeta base de portadas en Cloudinary es diferente.
    // Asumimos que el nombre del archivo de la portada es el mismo que el modelSlug.
    const baseCoverPath = `iz_management_website/covers/${gender}`;
    const publicId = `${baseCoverPath}/${modelSlug}`; 
    
    // Genera la URL de Cloudinary para la portada con transformaciones.
    return cloudinary.url(publicId, {
        width: 300, // Ancho de ejemplo para portadas, ajusta según tu diseño
        height: 400, // Alto de ejemplo
        crop: "fill", // Tipo de recorte (fill, thumb, crop, etc.), elige el que mejor se adapte a tu diseño
        secure: true,
        quality: "auto", // Optimización automática de calidad
        fetch_format: "auto" // Entrega el formato más eficiente (ej. WebP)
    });
}


// --- SCRIPT PRINCIPAL DE CONSTRUCCIÓN ---

async function buildSite() {
    console.log('Starting site build...');
    
    // 1. Limpiar el directorio de salida
    await fs.emptyDir(OUTPUT_DIR);
    console.log(`Cleaned output directory: ${OUTPUT_DIR}`);

    // 2. Obtener datos de modelos desde Airtable
    console.log('Fetching model data...');
    const allModels = await fetchAirtableData(); // Obtenemos los datos de Airtable

    // --- DEBUG: Géneros de los modelos procesados desde Airtable ---
    console.log("\n--- DEBUG: Géneros de los modelos procesados desde Airtable ---");
    allModels.forEach(model => {
        console.log(`Modelo: ${model.fullName} (Slug: ${model.modelSlug}) -> Género procesado: '${model.gender}'`);
    });
    console.log("-----------------------------------------------------------\n");
    // --- FIN DE LÍNEAS DEPURACIÓN ---

    // 3. Enriquecer datos de modelos con imágenes de portafolio de Cloudinary
    console.log('Processing model data and fetching portfolio images from Cloudinary...');
    const modelsWithData = await Promise.all(allModels.map(async (model) => {
        // Construir URL de portada de Cloudinary
        const coverImageUrl = getCoverImageUrl(model.modelSlug, model.gender);

        // Construir la ruta de la carpeta de portafolio en Cloudinary.
        const portfolioFolderPath = `iz_management_website/portfolios/${model.gender}/${model.modelSlug}`;
        const portfolioImageUrls = await getImagesFromFolder(portfolioFolderPath);
        
        console.log(`- Found ${portfolioImageUrls.length} portfolio images for ${model.fullName} (Slug: ${model.modelSlug}) in Cloudinary.`);
        
        return { ...model, coverImageUrl, portfolioImageUrls };
    }));

    // 4. Filtrar modelos por género
    const menModels = modelsWithData.filter(model => model.gender === 'men');
    const womenModels = modelsWithData.filter(model => model.gender === 'women');

    // 5. Renderizar páginas individuales de modelos
    console.log('Rendering individual model pages...');
    for (const model of modelsWithData) {
        if (model.gender === 'unassigned') {
            console.warn(`Skipping unassigned model: ${model.fullName}`);
            continue;
        }
        const modelOutputPath = path.join(OUTPUT_DIR, 'models', model.gender, `${model.modelSlug}.html`);
        await renderAndSave('model-page.ejs', { model }, modelOutputPath);
    }

    // 6. Renderizar páginas de categorías
    console.log('Rendering category pages...');
    if (menModels.length > 0) {
        await renderAndSave('category-page.ejs', { models: menModels, title: "Men's Portfolio" }, path.join(OUTPUT_DIR, 'men.html'));
    } else {
        console.log("No men models found to render men.html.");
    }
    if (womenModels.length > 0) {
        await renderAndSave('category-page.ejs', { models: womenModels, title: "Women's Portfolio" }, path.join(OUTPUT_DIR, 'women.html'));
    } else {
        console.log("No women models found to render women.html.");
    }

    // 7. Renderizar página de índice
    console.log('Rendering index page...');
    await renderAndSave('index-page.ejs', { hasMen: menModels.length > 0, hasWomen: womenModels.length > 0 }, path.join(OUTPUT_DIR, 'index.html'));
    
    // 8. Copiar CSS
    console.log('Copying CSS...');
    if (await fs.pathExists(CSS_SOURCE_PATH)) {
        await fs.copy(CSS_SOURCE_PATH, CSS_OUTPUT_PATH);
        console.log('Copied style.css to public/ directory.');
    } else {
        console.warn(`CSS file not found at ${CSS_SOURCE_PATH}. Skipping CSS copy.`);
    }

    console.log('\nSite build completed successfully!');
}

// Ejecutamos el script y capturamos cualquier error
buildSite().catch(err => {
    console.error("\nBUILD FAILED:", err);
    process.exit(1); 
});