(async () => {
  try {
    const mediaSources = [];
    for (const [index, video] of [...document.querySelectorAll('video')].entries()) {
      const media = new MediaSource(); mediaSources.push(media);
      video.src = URL.createObjectURL(media);
      await new Promise(resolve => media.addEventListener('sourceopen', resolve, { once: true }));
      const tracks = index === 0
        ? [['download-stream.mp4', 'video/mp4; codecs="avc1.640015,mp4a.40.2"']]
        : [['download-stream-video.mp4', 'video/mp4; codecs="avc1.640015"'], ['download-stream-audio.m4a', 'audio/mp4; codecs="mp4a.40.2"']];
      // Register every track before appending the first initialization segment.
      const buffers = tracks.map(([, mime]) => media.addSourceBuffer(mime));
      for (const [track, [file]] of tracks.entries()) {
        const response = await fetch(`./${file}?player=${index}`);
        const data = await response.arrayBuffer();
        const buffer = buffers[track];
        buffer.appendBuffer(data);
        await new Promise(resolve => buffer.addEventListener('updateend', resolve, { once: true }));
      }
      media.endOfStream();
    }
    // Keep each MediaSource owned by the fixture while its player is active.
    document.getElementById('status').textContent = `${mediaSources.length} independent streams ready. Both contain video and audio.`;
    window.fixtureMediaSources = mediaSources;
  } catch (error) { document.getElementById('status').textContent = String(error); }
})();
