const fs = require('fs');
const path = require('path');

const credentialsFile = 'google-credentials.json';
const fullPath = path.join(process.cwd(), credentialsFile);

console.log(`Intentando leer el archivo en la ruta: ${fullPath}`);

try {
    // 1. Intentamos leer el contenido del archivo
    const fileContent = fs.readFileSync(fullPath, 'utf8');

    // Si el archivo está vacío, fileContent será ""
    if (!fileContent) {
        throw new Error("El archivo google-credentials.json está vacío.");
    }

    // 2. Intentamos interpretar el contenido como JSON
    const jsonData = JSON.parse(fileContent);

    // 3. Si todo sale bien, mostramos un mensaje de éxito
    console.log("\n¡ÉXITO! El archivo fue encontrado y leído correctamente.");
    console.log(`El project_id en tu llave es: ${jsonData.project_id}`);

} catch (error) {
    // Si algo falla, mostramos el error completo
    console.error("\n¡FALLÓ LA PRUEBA! Aquí está el error exacto:");
    console.error(error); 
}