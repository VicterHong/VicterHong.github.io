/**
 * Custom Video Player
 * Premium controls with ornamental progress bar
 * No external player dependencies
 */

export function initVideoPlayer(videoElement) {
  if (!videoElement) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'video-player';
  videoElement.parentNode.insertBefore(wrapper, videoElement);
  wrapper.appendChild(videoElement);

  // Create controls
  const controls = document.createElement('div');
  controls.className = 'video-controls';
  controls.innerHTML = `
    <div class="video-progress">
      <div class="video-progress-filled"></div>
      <div class="video-progress-thumb"></div>
    </div>
    <div class="video-controls-row">
      <button class="video-btn video-play" aria-label="Play">
        <span class="icon-play">▶</span>
        <span class="icon-pause" style="display:none;">⏸</span>
      </button>
      <span class="video-time">
        <span class="time-current">0:00</span> / <span class="time-duration">0:00</span>
      </span>
    </div>
  `;
  wrapper.appendChild(controls);

  // Elements
  const playBtn = controls.querySelector('.video-play');
  const iconPlay = controls.querySelector('.icon-play');
  const iconPause = controls.querySelector('.icon-pause');
  const progress = controls.querySelector('.video-progress');
  const progressFilled = controls.querySelector('.video-progress-filled');
  const progressThumb = controls.querySelector('.video-progress-thumb');
  const timeCurrent = controls.querySelector('.time-current');
  const timeDuration = controls.querySelector('.time-duration');

  // Format time
  function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Update progress
  function updateProgress() {
    const percent = (videoElement.currentTime / videoElement.duration) * 100;
    progressFilled.style.width = `${percent}%`;
    progressThumb.style.left = `${percent}%`;
    timeCurrent.textContent = formatTime(videoElement.currentTime);
  }

  // Play/pause
  function togglePlay() {
    if (videoElement.paused) {
      videoElement.play();
      iconPlay.style.display = 'none';
      iconPause.style.display = 'inline';
      wrapper.classList.add('is-playing');
    } else {
      videoElement.pause();
      iconPlay.style.display = 'inline';
      iconPause.style.display = 'none';
      wrapper.classList.remove('is-playing');
    }
  }

  // Seek
  function seek(e) {
    const rect = progress.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    videoElement.currentTime = percent * videoElement.duration;
  }

  // Event listeners
  playBtn.addEventListener('click', togglePlay);
  videoElement.addEventListener('click', togglePlay);
  videoElement.addEventListener('timeupdate', updateProgress);
  
  videoElement.addEventListener('loadedmetadata', () => {
    timeDuration.textContent = formatTime(videoElement.duration);
    wrapper.classList.remove('is-loading');
  });

  videoElement.addEventListener('waiting', () => {
    wrapper.classList.add('is-loading');
  });

  videoElement.addEventListener('canplay', () => {
    wrapper.classList.remove('is-loading');
  });

  progress.addEventListener('click', seek);

  // Keyboard support
  videoElement.setAttribute('tabindex', '0');
  videoElement.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
    }
  });

  // Cleanup
  return () => {
    playBtn.removeEventListener('click', togglePlay);
    videoElement.removeEventListener('click', togglePlay);
    videoElement.removeEventListener('timeupdate', updateProgress);
    progress.removeEventListener('click', seek);
  };
}

// Auto-init for all videos with [data-custom-player]
export function initAllVideoPlayers() {
  const videos = document.querySelectorAll('video[data-custom-player]');
  videos.forEach(video => initVideoPlayer(video));
}
