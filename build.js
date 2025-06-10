// Importar las librerías necesarias
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs-extra');
const ejs = require('ejs');
require('dotenv').config();

// --- CONFIGURACIÓN ---
// Lee las variables de tu archivo .env
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_DRIVE_COVERS_FOLDER_ID = process.env.GOOGLE_DRIVE_COVERS_FOLDER_ID;
const GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID = process.env.GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID;
const SHEET_RANGE = 'Sheet1!A2:E';

// --- RUTAS DEL PROYECTO ---
const CREDENTIALS_PATH = path.join(process.cwd(), 'google-credentials.json');
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');
const OUTPUT_DIR = path.join(process.cwd(), 'public');
const CSS_SOURCE_PATH = path.join(process.cwd(), 'src', 'css', 'style.css');
const CSS_OUTPUT_PATH = path.join(OUTPUT_DIR, 'style.css');


// --- FUNCIONES DE AYUDA (HELPERS) ---

/**
 * Se autentica con la API de Google usando las credenciales.
 */
async function authenticateGoogle() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
    return await auth.getClient();
}

/**
 * Obtiene los datos de texto de los modelos desde la hoja de cálculo.
 */
async function fetchSheetData(authClient) {
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: SHEET_RANGE,
    });
    if (!response.data.values) {
        console.log('No data found in sheet.');
        return [];
    }
    const models = response.data.values.map(row => ({
        modelSlug: row[0]?.trim() || '', fullName: row[1]?.trim() || '',
        gender: row[2]?.trim().toLowerCase() || 'unassigned', description: row[3]?.trim() || '',
        instagramHandle: row[4]?.trim() || ''
    }));
    console.log(`Successfully fetched ${models.length} text data rows from the sheet.`);
    return models;
}

/**
 * Busca el ID de una sub-carpeta por su nombre dentro de una carpeta padre.
 */
async function findFolderIdByName(drive, parentId, folderName) {
    if (!parentId || !folderName) return null;
    const res = await drive.files.list({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1
    });
    return res.data.files.length ? res.data.files[0].id : null;
}

/**
 * Obtiene una lista de archivos de imagen de una carpeta de Drive.
 */
async function getImagesFromFolder(drive, folderId) {
    if (!folderId) return [];
    const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        // *** ¡CORRECCIÓN FINAL AQUÍ! *** Se asegura de pedir siempre el id, nombre y thumbnailLink
        fields: 'files(id, name, thumbnailLink)',
        pageSize: 50
    });
    return res.data.files || [];
}

/**
 * Busca todas las imágenes de portada en las carpetas 'men' y 'women'.
 */
async function fetchCoverImages(drive) {
    const coverImages = new Map();
    const menCoversFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_COVERS_FOLDER_ID, 'men');
    if (menCoversFolderId) {
        const menFiles = await getImagesFromFolder(drive, menCoversFolderId);
        menFiles.forEach(file => {
            if(file && file.name) {
                // Usamos el nombre del archivo SIN extensión como clave
                coverImages.set(path.parse(file.name).name, file.thumbnailLink)
            }
        });
    }
    const womenCoversFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_COVERS_FOLDER_ID, 'women');
    if (womenCoversFolderId) {
        const womenFiles = await getImagesFromFolder(drive, womenCoversFolderId);
        womenFiles.forEach(file => {
            if(file && file.name) {
                coverImages.set(path.parse(file.name).name, file.thumbnailLink)
            }
        });
    }
    console.log(`Successfully fetched ${coverImages.size} cover images.`);
    return coverImages;
}

/**
 * Renderiza una plantilla EJS y la guarda como un archivo HTML.
 */
async function renderAndSave(templateName, data, outputPath) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    const html = await ejs.renderFile(templatePath, data, { async: true });
    await fs.outputFile(outputPath, html);
}


// --- SCRIPT PRINCIPAL DE CONSTRUCCIÓN ---

async function buildSite() {
    console.log('Starting site build...');
    await fs.emptyDir(OUTPUT_DIR);

    const authClient = await authenticateGoogle();
    const drive = google.drive({ version: 'v3', auth: authClient });
    
    // Obtenemos todos los datos de Sheets y las portadas de Drive al mismo tiempo
    const [allModels, coverImages] = await Promise.all([
        fetchSheetData(authClient),
        fetchCoverImages(drive)
    ]);
    
    // Obtenemos los IDs de las carpetas de portafolios (galerías)
    const menPortfolioFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID, 'men');
    const womenPortfolioFolderId = await findFolderIdByName(drive, GOOGLE_DRIVE_PORTFOLIOS_FOLDER_ID, 'women');

    // Unimos toda la información para cada modelo
    const modelsWithData = await Promise.all(allModels.map(async (model) => {
        // Asignar la imagen de portada
        const coverImageUrl = coverImages.get(model.modelSlug) || `https://via.placeholder.com/300x400.png?text=No+Image`;

        // Asignar la galería de imágenes del portafolio
        const parentPortfolioFolderId = model.gender === 'men' ? menPortfolioFolderId : womenPortfolioFolderId;
        const modelPortfolioFolderId = await findFolderIdByName(drive, parentPortfolioFolderId, model.modelSlug);
        const portfolioFiles = await getImagesFromFolder(drive, modelPortfolioFolderId);
        // Usamos el thumbnailLink (más grande) para asegurar que se vean
        const portfolioImageUrls = portfolioFiles.map(file => file.thumbnailLink ? file.thumbnailLink.replace('=s220', '=s1600') : '');
        
        console.log(`- Found ${portfolioImageUrls.length} portfolio images for ${model.fullName}`);
        
        // Devolvemos el objeto completo con toda la información
        return { ...model, coverImageUrl, portfolioImageUrls };
    }));

    // Filtramos los modelos por género
    const menModels = modelsWithData.filter(model => model.gender === 'men');
    const womenModels = modelsWithData.filter(model => model.gender === 'women');

    // Generamos todas las páginas HTML
    for (const model of modelsWithData) {
        if (model.gender === 'unassigned') continue;
        const modelOutputPath = path.join(OUTPUT_DIR, 'models', model.gender, `${model.modelSlug}.html`);
        await renderAndSave('model-page.ejs', { model }, modelOutputPath);
    }
    if (menModels.length > 0) await renderAndSave('category-page.ejs', { models: menModels, title: "Men's Portfolio" }, path.join(OUTPUT_DIR, 'men.html'));
    if (womenModels.length > 0) await renderAndSave('category-page.ejs', { models: womenModels, title: "Women's Portfolio" }, path.join(OUTPUT_DIR, 'women.html'));
    await renderAndSave('index-page.ejs', { hasMen: menModels.length > 0, hasWomen: womenModels.length > 0 }, path.join(OUTPUT_DIR, 'index.html'));
    
    // Copiamos el archivo CSS
    if (await fs.pathExists(CSS_SOURCE_PATH)) {
        await fs.copy(CSS_SOURCE_PATH, CSS_OUTPUT_PATH);
        console.log('Copied style.css to public/ directory.');
    }

    console.log('\nSite build completed successfully!');
}

// Ejecutamos el script y capturamos cualquier error
buildSite().catch(err => {
    console.error("\nBUILD FAILED:", err.message, err.stack);
    process.exit(1);
});