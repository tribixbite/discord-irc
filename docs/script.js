// Configuration Generator
function updateConfig() {
    const config = {
        nickname: document.getElementById('bot-nickname')?.value || 'DiscordBot',
        server: document.getElementById('irc-server')?.value || 'irc.libera.chat',
        port: 6697,
        secure: true,
        discordToken: document.getElementById('discord-token')?.value || 'YOUR_DISCORD_BOT_TOKEN',
        channelMapping: {}
    };

    // Basic channel mapping
    const discordChannelId = document.getElementById('discord-channel')?.value;
    const ircChannel = document.getElementById('irc-channel')?.value;
    if (discordChannelId && ircChannel) {
        config.channelMapping[discordChannelId] = ircChannel;
    } else if (!discordChannelId && !ircChannel) {
        config.channelMapping['DISCORD_CHANNEL_ID'] = '#irc-channel';
    }

    // Advanced features
    const webhookUrl = document.getElementById('webhook-url')?.value;
    if (webhookUrl) {
        config.webhooks = {
            [discordChannelId || 'DISCORD_CHANNEL_ID']: webhookUrl
        };
    }

    const pmChannelId = document.getElementById('pm-channel')?.value;
    if (pmChannelId) {
        config.privateMessages = {
            enabled: true,
            channelId: pmChannelId,
            threadPrefix: 'PM: ',
            autoArchive: 60
        };
    }

    const rateLimiting = document.getElementById('rate-limiting')?.checked;
    if (rateLimiting) {
        config.rateLimiting = {
            enabled: true,
            maxMessages: 5,
            windowMs: 60000,
            blockDuration: 300000
        };
    }

    const statusNotifications = document.getElementById('status-notifications')?.checked;
    if (statusNotifications) {
        config.statusNotifications = {
            enabled: true,
            includeJoins: true,
            includeLeaves: true
        };
    }

    // Enterprise features
    const redisUrl = document.getElementById('redis-url')?.value;
    if (redisUrl) {
        config.persistence = {
            type: 'redis',
            config: {
                url: redisUrl
            }
        };
    }

    const configJson = JSON.stringify(config, null, 2);
    const previewElement = document.getElementById('config-preview');
    if (previewElement) {
        previewElement.textContent = configJson;
    }
}

function copyConfig(button) {
    const preview = document.getElementById('config-preview');
    if (preview) {
        navigator.clipboard.writeText(preview.textContent).then(() => {
            if (button) {
                const originalText = button.textContent;
                button.textContent = 'Copied!';
                button.style.background = 'var(--accent-secondary)';
                
                setTimeout(() => {
                    button.textContent = originalText;
                    button.style.background = '';
                }, 2000);
            }
        }).catch(err => {
            console.error('Failed to copy config:', err);
            if (button) {
                button.textContent = 'Error!';
                setTimeout(() => {
                    button.textContent = 'Copy Config';
                }, 2000);
            }
        });
    }
}

// Download configuration file
function downloadConfig() {
    const configJson = document.getElementById('config-preview').textContent;
    const blob = new Blob([configJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'config.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Tab switching for configuration helper
function switchTab(tabName) {
    // Remove active class from all tabs and content
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Add active class to clicked tab and corresponding content
    const clickedTab = event.target;
    clickedTab.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');
    
    // Update config when switching tabs
    updateConfig();
}

// Copy code from code blocks
function copyCode(button) {
    const codeBlock = button.parentNode.querySelector('code');
    if (codeBlock) {
        const text = codeBlock.textContent;
        navigator.clipboard.writeText(text).then(() => {
            const originalText = button.textContent;
            button.textContent = 'Copied!';
            button.style.background = 'var(--accent-secondary)';
            button.style.color = 'white';
            
            setTimeout(() => {
                button.textContent = originalText;
                button.style.background = '';
                button.style.color = '';
            }, 2000);
        }).catch(err => {
            console.error('Could not copy text:', err);
            button.textContent = 'Error!';
            setTimeout(() => {
                button.textContent = 'Copy';
            }, 2000);
        });
    }
}

// Documentation Loading (for docs.html)
async function loadDocumentation() {
    try {
        // Try to load processed README content
        let response = await fetch('./readme-content.json');
        let data;
        
        if (response.ok) {
            data = await response.json();
        } else {
            // Fallback: load README.md directly and use a proper markdown parser
            response = await fetch('../README.md');
            if (!response.ok) throw new Error('Failed to load documentation');
            
            const markdown = await response.text();
            
            // Use a more robust approach - try to load marked.js if available
            if (typeof marked !== 'undefined') {
                data = {
                    content: marked.parse(markdown),
                    sections: extractSections(markdown),
                    lastUpdated: new Date().toISOString()
                };
            } else {
                // Basic fallback - better than the original but still limited
                data = {
                    content: convertMarkdownToHTML(markdown),
                    sections: extractSections(markdown),
                    lastUpdated: new Date().toISOString()
                };
            }
        }

        // Update content
        const docsBody = document.getElementById('docs-body');
        if (docsBody) {
            docsBody.innerHTML = data.content;
        }
        
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            lastUpdated.textContent = new Date(data.lastUpdated).toLocaleDateString();
        }

        // Generate navigation
        generateNavigation(data.sections);

        // Highlight code blocks if hljs is available
        if (typeof hljs !== 'undefined') {
            hljs.highlightAll();
        }

        // Add copy buttons to code blocks
        addCopyButtons();

        // Setup scroll spy
        setupScrollSpy();

    } catch (error) {
        console.error('Failed to load documentation:', error);
        const docsBody = document.getElementById('docs-body');
        if (docsBody) {
            docsBody.innerHTML = `
                <div class="message error">
                    <p>Failed to load documentation. Please try refreshing the page or visit the 
                    <a href="https://github.com/discord-irc/discord-irc/blob/main/README.md" target="_blank">GitHub repository</a> 
                    to view the documentation.</p>
                </div>
            `;
        }
        
        const docsNav = document.getElementById('docs-nav');
        if (docsNav) {
            docsNav.innerHTML = `
                <div class="message error">
                    <p>Navigation unavailable</p>
                </div>
            `;
        }
    }
}

// Improved markdown to HTML converter (still basic, but better)
function convertMarkdownToHTML(markdown) {
    let html = markdown
        // Headers
        .replace(/^### (.*$)/gim, '<h3 id="$1">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 id="$1">$1</h2>')
        .replace(/^# (.*$)/gim, '<h1 id="$1">$1</h1>')
        // Bold and italic
        .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        // Links
        .replace(/\[([^\]]*)\]\(([^)]*)\)/gim, '<a href="$2">$1</a>')
        // Inline code
        .replace(/`([^`]*)`/gim, '<code>$1</code>')
        // Lists (basic)
        .replace(/^- (.*$)/gim, '<li>$1</li>');
    
    // Handle code blocks more carefully
    html = html.replace(/```([^`]*)```/gim, (match, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });
    
    // Convert line breaks to paragraphs (avoiding inside code blocks)
    const lines = html.split('\n');
    let inCodeBlock = false;
    let result = [];
    let currentParagraph = [];
    
    for (const line of lines) {
        if (line.includes('<pre>')) inCodeBlock = true;
        if (line.includes('</pre>')) inCodeBlock = false;
        
        if (inCodeBlock || line.trim().startsWith('<') || line.trim() === '') {
            if (currentParagraph.length > 0) {
                result.push(`<p>${currentParagraph.join(' ')}</p>`);
                currentParagraph = [];
            }
            if (line.trim() !== '') {
                result.push(line);
            }
        } else {
            currentParagraph.push(line.trim());
        }
    }
    
    if (currentParagraph.length > 0) {
        result.push(`<p>${currentParagraph.join(' ')}</p>`);
    }
    
    return result.join('\n');
}

// Extract sections from markdown
function extractSections(markdown) {
    const sections = [];
    const lines = markdown.split('\n');
    
    lines.forEach(line => {
        const match = line.match(/^(#+)\s+(.+)$/);
        if (match) {
            const level = match[1].length;
            const title = match[2].replace(/[^a-zA-Z0-9\s]/g, '').trim();
            const id = title.toLowerCase().replace(/\s+/g, '-');
            sections.push({ title, id, level });
        }
    });
    
    return sections;
}

// Generate navigation menu
function generateNavigation(sections) {
    const nav = document.getElementById('docs-nav');
    if (!nav) return;
    
    let html = '';
    
    sections.forEach(section => {
        const indent = section.level > 2 ? 'style="padding-left: 1.5rem;"' : '';
        html += `<a href="#${section.id}" ${indent}>${section.title}</a>`;
    });
    
    nav.innerHTML = html;
}

// Add copy buttons to code blocks (fixed version)
function addCopyButtons() {
    document.querySelectorAll('pre').forEach(pre => {
        const code = pre.querySelector('code');
        if (!code) return; // Skip if no code element found
        
        const button = document.createElement('button');
        button.className = 'copy-btn';
        button.textContent = 'Copy';
        button.style.position = 'absolute';
        button.style.top = '0.5rem';
        button.style.right = '0.5rem';
        button.style.background = 'var(--bg-hover)';
        button.style.border = '1px solid var(--border-color)';
        button.style.borderRadius = '4px';
        button.style.padding = '0.25rem 0.5rem';
        button.style.color = 'var(--text-secondary)';
        button.style.fontSize = '0.75rem';
        button.style.cursor = 'pointer';
        
        button.addEventListener('click', () => {
            const text = code.textContent;
            
            navigator.clipboard.writeText(text).then(() => {
                button.textContent = 'Copied!';
                button.style.background = 'var(--accent-secondary)';
                button.style.color = 'white';
                
                setTimeout(() => {
                    button.textContent = 'Copy';
                    button.style.background = 'var(--bg-hover)';
                    button.style.color = 'var(--text-secondary)';
                }, 2000);
            });
        });
        
        pre.style.position = 'relative';
        pre.appendChild(button);
    });
}

// Setup scroll spy for navigation
function setupScrollSpy() {
    const navLinks = document.querySelectorAll('.docs-nav a');
    const sections = document.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
    
    function updateActiveLink() {
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 100;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });
        
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    }
    
    window.addEventListener('scroll', updateActiveLink);
    updateActiveLink(); // Initial call
}

// Navbar scroll effect
function handleNavbarScroll() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        if (window.scrollY > 100) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    }
}

// Initialize everything when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Set up config generator if on main page
    const configInputs = document.querySelectorAll('#config input, #config textarea');
    configInputs.forEach(input => {
        input.addEventListener('input', updateConfig);
    });
    
    // Initial config generation
    if (document.getElementById('config-preview')) {
        updateConfig();
    }
    
    // Load documentation if on docs page
    if (document.getElementById('docs-body')) {
        loadDocumentation();
    }
    
    // Set up navbar scroll effect
    window.addEventListener('scroll', handleNavbarScroll);
    
    // Add smooth scrolling for anchor links
    document.addEventListener('click', (e) => {
        if (e.target.tagName === 'A' && e.target.getAttribute('href')?.startsWith('#')) {
            e.preventDefault();
            const targetId = e.target.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    });
});