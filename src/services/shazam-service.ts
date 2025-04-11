import {Shazam} from 'node-shazam'
import {PlaybackInfo} from '../types';

export class ShazamService {
    private shazamApi: Shazam;

    constructor() {
        this.shazamApi = new Shazam();
    }

    public async findTrack(data: string): Promise<PlaybackInfo> {
        const song = await this.shazamApi.search_music("en-US", "GB", data, "1", "0");
        if (song.tracks.hits) {
            const trackName = song.tracks.hits[0].heading.title;
            const artist = song.tracks.hits[0].heading.subtitle;

            return {
                trackName: trackName, 
                artists: artist
            }
        }
        
        return {};
    }
}

export const shazamService = new ShazamService();