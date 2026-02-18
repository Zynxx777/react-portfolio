import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET() {
  const musicDir = path.join(process.cwd(), 'public', 'music');

  try {
    const files = await fs.promises.readdir(musicDir);
    const extensions = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus'];
    const musicFiles = files.filter(file => extensions.some(ext => file.toLowerCase().endsWith(ext)));
    
    // Create a list of objects with name and path
    const tracks = musicFiles.map((file, index) => {
        const ext = path.extname(file);
        return {
            id: index,
            title: path.basename(file, ext),
            path: `/music/${file}`
        };
    });

    return NextResponse.json(tracks);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to read music directory' }, { status: 500 });
  }
}
