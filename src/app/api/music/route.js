import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  const musicDir = path.join(process.cwd(), 'public', 'music');

  try {
    const files = await fs.promises.readdir(musicDir);
    const musicFiles = files.filter(file => file.endsWith('.mp3'));
    
    // Create a list of objects with name and path
    const tracks = musicFiles.map((file, index) => ({
        id: index,
        title: file.replace('.mp3', ''), // Simple title from filename
        path: `/music/${file}`
    }));

    return NextResponse.json(tracks);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read music directory' }, { status: 500 });
  }
}
