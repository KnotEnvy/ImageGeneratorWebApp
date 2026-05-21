/**
 * CanvasEditor - Interactive HTML5 Canvas motivational message compositor
 */
export class CanvasEditor {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.backgroundImage = null;
        
        // Editor State
        this.state = {
            // Text Overlays
            overlays: {
                header: {
                    text: 'DREAM BIG',
                    active: true,
                    yPct: 0.20, // vertical position as % of canvas height
                    fontFamily: 'Outfit',
                    fontSize: 48,
                    fontWeight: '800',
                    color: '#facc15',
                    alignment: 'center',
                    letterSpacing: 6,
                    lineHeight: 1.2,
                    shadowBlur: 8,
                    shadowColor: '#000000',
                    outlineActive: false,
                    outlineColor: '#000000',
                    outlineWidth: 3,
                    bgActive: false,
                    bgColor: '#000000',
                    bgOpacity: 50
                },
                quote: {
                    text: 'The only limit to our realization of tomorrow will be our doubts of today.',
                    active: true,
                    yPct: 0.50,
                    fontFamily: 'Playfair Display',
                    fontSize: 32,
                    fontWeight: '600',
                    color: '#ffffff',
                    alignment: 'center',
                    letterSpacing: 1,
                    lineHeight: 1.4,
                    shadowBlur: 10,
                    shadowColor: '#000000',
                    outlineActive: false,
                    outlineColor: '#000000',
                    outlineWidth: 3,
                    bgActive: false,
                    bgColor: '#000000',
                    bgOpacity: 50
                },
                author: {
                    text: '— Franklin D. Roosevelt',
                    active: true,
                    yPct: 0.78,
                    fontFamily: 'Inter',
                    fontSize: 18,
                    fontWeight: '400',
                    color: '#a1a1aa',
                    alignment: 'center',
                    letterSpacing: 2,
                    lineHeight: 1.2,
                    shadowBlur: 6,
                    shadowColor: '#000000',
                    outlineActive: false,
                    outlineColor: '#000000',
                    outlineWidth: 3,
                    bgActive: false,
                    bgColor: '#000000',
                    bgOpacity: 50
                }
            },
            // Filters
            filters: {
                brightness: 85, // %
                contrast: 105,   // %
                saturation: 90, // %
                blur: 1,        // px
                vignette: 0.4   // opacity (0 to 1)
            }
        };

        // Interaction State
        this.draggedKey = null;
        this.isDragging = false;

        this.initEvents();
    }

    /**
     * Set the current background image from a base64 DataURL or Image object
     * @param {string|Image} imgSource 
     * @returns {Promise} Resolves when the image is loaded and drawn
     */
    loadImage(imgSource) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                this.backgroundImage = img;
                // Set canvas internal resolution to match generated image (typically 1024x1024 or similar)
                this.canvas.width = img.naturalWidth || 1024;
                this.canvas.height = img.naturalHeight || 1024;
                this.draw();
                resolve();
            };
            img.onerror = (err) => {
                reject(err);
            };
            
            if (typeof imgSource === 'string') {
                img.src = imgSource;
            } else if (imgSource instanceof Image) {
                img.src = imgSource.src;
            } else {
                reject(new Error('Invalid image source'));
            }
        });
    }

    /**
     * Update filter configurations
     */
    updateFilter(filterName, value) {
        if (filterName in this.state.filters) {
            this.state.filters[filterName] = Number(value);
            this.draw();
        }
    }

    /**
     * Update text overlay properties
     */
    updateOverlay(key, properties) {
        if (key in this.state.overlays) {
            this.state.overlays[key] = {
                ...this.state.overlays[key],
                ...properties
            };
            this.draw();
        }
    }

    /**
     * Render everything onto the canvas
     */
    draw() {
        if (!this.backgroundImage) return;

        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        this.ctx.clearRect(0, 0, width, height);

        // 1. Draw Background Image with Filters
        this.ctx.save();
        const f = this.state.filters;
        this.ctx.filter = `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturation}%) blur(${f.blur}px)`;
        this.ctx.drawImage(this.backgroundImage, 0, 0, width, height);
        this.ctx.restore();

        // 2. Draw Vignette Overlay (always drawn on top of background filters, below text)
        if (f.vignette > 0) {
            this.drawVignette(width, height, f.vignette);
        }

        // 3. Draw Text Overlays
        for (const [key, overlay] of Object.entries(this.state.overlays)) {
            if (!overlay.active || !overlay.text.trim()) continue;
            this.drawTextOverlay(overlay, width, height);
        }
    }

    /**
     * Draw radial vignette overlay
     */
    drawVignette(width, height, strength) {
        this.ctx.save();
        const centerX = width / 2;
        const centerY = height / 2;
        const innerRadius = Math.min(width, height) * 0.25;
        const outerRadius = Math.max(width, height) * 0.7;

        const gradient = this.ctx.createRadialGradient(
            centerX, centerY, innerRadius,
            centerX, centerY, outerRadius
        );

        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, `rgba(0, 0, 0, ${strength})`);

        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);
        this.ctx.restore();
    }

    /**
     * Draw single text overlay block with word wrapping
     */
    drawTextOverlay(overlay, canvasWidth, canvasHeight) {
        this.ctx.save();

        const x = canvasWidth / 2; // Default horizontal centering
        const y = canvasHeight * overlay.yPct;

        // Configure typography
        this.ctx.font = `${overlay.fontWeight} ${overlay.fontSize}px ${overlay.fontFamily}`;
        this.ctx.fillStyle = overlay.color;
        this.ctx.textAlign = overlay.alignment;
        this.ctx.textBaseline = 'middle';

        // Word wrapping
        const maxTextWidth = canvasWidth * 0.85; // Padding left & right
        const wrappedLines = this.wrapText(overlay.text, maxTextWidth);
        const lineHeight = overlay.fontSize * overlay.lineHeight;
        const totalHeight = wrappedLines.length * lineHeight;
        
        // Draw each line centered vertically around the overlay's anchor Y position
        const yStart = y - (totalHeight / 2) + (lineHeight / 2);

        // Calculate and draw background backing box if active
        if (overlay.bgActive && overlay.bgOpacity > 0) {
            let maxLineWidth = 0;
            wrappedLines.forEach(line => {
                let w;
                if (overlay.letterSpacing > 0) {
                    const chars = line.split('');
                    w = this.ctx.measureText(line).width + (chars.length - 1) * overlay.letterSpacing;
                } else {
                    w = this.ctx.measureText(line).width;
                }
                if (w > maxLineWidth) maxLineWidth = w;
            });

            const padX = overlay.fontSize * 0.5;
            const padY = overlay.fontSize * 0.35;
            const boxWidth = maxLineWidth + padX * 2;
            const boxHeight = totalHeight + padY * 2;
            const boxY = y - (totalHeight / 2) - padY;
            
            let boxX;
            if (overlay.alignment === 'center') {
                boxX = x - (boxWidth / 2);
            } else if (overlay.alignment === 'left') {
                boxX = (canvasWidth * 0.075) - padX;
            } else { // right
                boxX = (canvasWidth * 0.925) - boxWidth + padX;
            }

            this.ctx.save();
            this.ctx.fillStyle = overlay.bgColor || '#000000';
            this.ctx.globalAlpha = (overlay.bgOpacity || 50) / 100;
            
            const radius = 8;
            this.ctx.beginPath();
            if (typeof this.ctx.roundRect === 'function') {
                this.ctx.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
            } else {
                this.ctx.rect(boxX, boxY, boxWidth, boxHeight);
            }
            this.ctx.fill();
            this.ctx.restore();
        }

        // Configure Text Shadow/Glow (for contrast against backgrounds, applied on top of the BG box)
        if (overlay.shadowBlur > 0) {
            this.ctx.shadowColor = overlay.shadowColor;
            this.ctx.shadowBlur = overlay.shadowBlur;
            this.ctx.shadowOffsetX = 0;
            this.ctx.shadowOffsetY = 2;
        }

        wrappedLines.forEach((line, index) => {
            const currentY = yStart + (index * lineHeight);
            
            // Adjust X alignment offsets if needed (for left/right options)
            let drawX = x;
            if (overlay.alignment === 'left') {
                drawX = canvasWidth * 0.075;
            } else if (overlay.alignment === 'right') {
                drawX = canvasWidth * 0.925;
            }

            // Draw outline first if enabled so the fill draws neatly on top
            if (overlay.outlineActive) {
                this.ctx.save();
                this.ctx.strokeStyle = overlay.outlineColor || '#000000';
                this.ctx.lineWidth = overlay.outlineWidth || 3;
                this.ctx.lineJoin = 'round';
                this.ctx.shadowBlur = 0; // Disable shadow on stroke to avoid blurred outline overlaps
                
                if (overlay.letterSpacing > 0) {
                    this.strokeTextWithSpacing(line, drawX, currentY, overlay.letterSpacing, overlay.alignment);
                } else {
                    this.ctx.strokeText(line, drawX, currentY);
                }
                this.ctx.restore();
            }

            // Implement custom letter spacing for fill
            if (overlay.letterSpacing > 0 && this.ctx.fillText) {
                this.fillTextWithSpacing(line, drawX, currentY, overlay.letterSpacing, overlay.alignment);
            } else {
                this.ctx.fillText(line, drawX, currentY);
            }
        });

        this.ctx.restore();
    }

    /**
     * Helper to draw text with custom letter-spacing
     */
    fillTextWithSpacing(text, x, y, letterSpacing, alignment) {
        const characters = text.split('');
        const totalWidth = this.ctx.measureText(text).width + (characters.length - 1) * letterSpacing;
        
        let currentX = x;
        if (alignment === 'center') {
            currentX = x - (totalWidth / 2);
        } else if (alignment === 'right') {
            currentX = x - totalWidth;
        }

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            this.ctx.fillText(char, currentX, y);
            currentX += this.ctx.measureText(char).width + letterSpacing;
        }
    }

    /**
     * Helper to stroke text with custom letter-spacing
     */
    strokeTextWithSpacing(text, x, y, letterSpacing, alignment) {
        const characters = text.split('');
        const totalWidth = this.ctx.measureText(text).width + (characters.length - 1) * letterSpacing;
        
        let currentX = x;
        if (alignment === 'center') {
            currentX = x - (totalWidth / 2);
        } else if (alignment === 'right') {
            currentX = x - totalWidth;
        }

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            this.ctx.strokeText(char, currentX, y);
            currentX += this.ctx.measureText(char).width + letterSpacing;
        }
    }

    /**
     * Helper to split string into wrapped lines
     */
    wrapText(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = this.ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && i > 0) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }
        return lines;
    }

    /**
     * Bind canvas mouse and touch events for interactive dragging
     */
    initEvents() {
        const getCanvasCoords = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            // Client coordinates mapped to actual canvas canvas dimensions
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            
            return {
                x: ((clientX - rect.left) / rect.width) * this.canvas.width,
                y: ((clientY - rect.top) / rect.height) * this.canvas.height
            };
        };

        const handleDown = (e) => {
            if (!this.backgroundImage) return;
            const coords = getCanvasCoords(e);
            const clickYPct = coords.y / this.canvas.height;

            // Find closest active text overlay
            let closestKey = null;
            let minDiff = 0.12; // Drag threshold (within 12% height of the text position)

            for (const [key, overlay] of Object.entries(this.state.overlays)) {
                if (!overlay.active || !overlay.text.trim()) continue;
                const diff = Math.abs(overlay.yPct - clickYPct);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestKey = key;
                }
            }

            if (closestKey) {
                this.draggedKey = closestKey;
                this.isDragging = true;
                this.canvas.style.cursor = 'ns-resize';
                e.preventDefault(); // Prevent text selection/scrolling
            }
        };

        const handleMove = (e) => {
            if (!this.isDragging || !this.draggedKey) {
                // Change cursor to pointer if hovering near a draggable element
                if (this.backgroundImage) {
                    const coords = getCanvasCoords(e);
                    const hoverYPct = coords.y / this.canvas.height;
                    let isHovering = false;
                    for (const overlay of Object.values(this.state.overlays)) {
                        if (overlay.active && overlay.text.trim() && Math.abs(overlay.yPct - hoverYPct) < 0.08) {
                            isHovering = true;
                            break;
                        }
                    }
                    this.canvas.style.cursor = isHovering ? 'ns-resize' : 'default';
                }
                return;
            }

            const coords = getCanvasCoords(e);
            let targetYPct = coords.y / this.canvas.height;
            
            // Clamp between 5% and 95% to prevent dragging off canvas
            targetYPct = Math.max(0.05, Math.min(0.95, targetYPct));
            
            this.state.overlays[this.draggedKey].yPct = targetYPct;
            this.draw();
            e.preventDefault();
        };

        const handleUp = () => {
            const wasDragging = this.isDragging;
            this.isDragging = false;
            this.draggedKey = null;
            this.canvas.style.cursor = 'default';
            if (wasDragging && typeof this.onDragEnd === 'function') {
                this.onDragEnd();
            }
        };

        this.canvas.addEventListener('mousedown', handleDown);
        this.canvas.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);

        this.canvas.addEventListener('touchstart', handleDown, { passive: false });
        this.canvas.addEventListener('touchmove', handleMove, { passive: false });
        window.addEventListener('touchend', handleUp);
    }

    /**
     * Export the final composition as a high-quality dataURL
     * @returns {string} PNG base64 DataURL
     */
    exportPNG() {
        return this.canvas.toDataURL('image/png', 1.0);
    }

    /**
     * Reset editor parameters to default
     */
    reset() {
        // Reset coordinates
        this.state.overlays.header.yPct = 0.20;
        this.state.overlays.quote.yPct = 0.50;
        this.state.overlays.author.yPct = 0.78;
        
        // Reset filters
        this.state.filters = {
            brightness: 85,
            contrast: 105,
            saturation: 90,
            blur: 1,
            vignette: 0.4
        };
        
        this.draw();
    }
}
