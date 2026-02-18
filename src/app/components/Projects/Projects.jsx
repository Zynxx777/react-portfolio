import Box from './components/Box'
import { useTranslations } from "next-intl";
import {motion} from 'framer-motion';
const container = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
      }
    }
  };
  
  const item = {
    hidden: { y: 10, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1
    }
  };

export default function Projects() {
    const t = useTranslations("Projects");

    const projects = [
      
        {name: 'mini music player', isOnline: true, link: 'https://zynxx777.github.io/mini-music-player', img: '/images/illustration-tourist-attraction-city.jpg', gif: '/images/illustration-tourist-attraction-city.jpg', description: t('os'), skills: ['react', 'ts', 'scss', 'figma']},
        {name: 'bedroom portfolio', isOnline: true, img: '/images/discourse.gif', gif: '/images/discourse.gif',  link: 'https://zynxx777.github.io/Portfolio', description:t('disc'), skills: ['next', 'tailwind', 'ts']},
        {name: 'Synthwave Visualizer', subtitle: 'Interactive Experience', img: '/images/futuristic-dubai-landscape.jpg', gif: '/images/futuristic-dubai-landscape.jpg', description: t('synthwave'), skills: ['react', 'threejs', 'ts'], link: '/visualizer'},
        {name: 'Cyberpunk 3D Room', subtitle: 'Immersive Environment', img: '/images/digital-art-beautiful-mountains.jpg', gif: '/images/digital-art-beautiful-mountains.jpg', description: t('cyberpunk'), skills: ['react', 'threejs', 'blender'], link: '/cyberpunk'},
        {name: 'Black Hole Universe', subtitle: 'Gravitational Simulation', img: '/images/kashi-os.gif', gif: '/images/kashi-os.gif', description: 'An immersive 3D black hole simulation with 8000 gravitationally-pulled stars, audio reactivity, and cursor interaction.', skills: ['react', 'threejs', 'glsl'], link: '/blackhole'},
];
    
    return <motion.section initial={{opacity: 0}} animate={{opacity: 1}} className="scroll-mt-16" id='projects'>
      <div className='flex flex-col gap-1 items-center'>
        <h2 className="text-4xl sm:text-3xl xs:text-xl xxs:text-xl mb-3 lg:mb-1 sm:mb-0">{t('title')}</h2>
        <label className='dark:bg-white/95 px-7 rounded-full text-center w-fit bg-accent-orange text-white dark:text-black/90 h-min flex-grow-0 lg:text-[10px] sm:text-[8px]'>{t('description')}</label>
      </div>
        <motion.ul variants={container} initial="hidden" whileInView="visible" viewport={{once: true}} className='grid grid-cols-3 gap-[60px] md:gap-9 lg:gap-2 my-[40px] dots md:grid-cols-1'>
            {projects.map((project) => {
               return <motion.li variants={item} key={project.name}>
                    <Box  {...project}/>
                </motion.li>
            })}
        </motion.ul>
    </motion.section>
}
